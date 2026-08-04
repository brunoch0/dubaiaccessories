import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const LV_BASE = "https://api.loyverse.com/v1.0";
// Loyverse 무료 플랜은 영수증 조회가 최근 31일로 제한됨 → 여유 있게 30일 전부터 백필
const backfillFrom = () => new Date(Date.now() - 30 * 86400_000).toISOString();

type LvLine = {
  sku?: string;
  quantity: number;
  price?: number; // 정가 단가
  gross_total_money?: number; // 정가 × 수량
  total_money?: number; // 실결제(할인 반영)
  total_discount?: number;
};
type LvReceipt = {
  receipt_number: string;
  receipt_type: string; // SALE | REFUND
  receipt_date?: string;
  created_at?: string;
  store_id: string;
  employee_id?: string;
  line_items?: LvLine[];
};

async function lv(path: string, token: string) {
  const res = await fetch(`${LV_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Loyverse API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!prof || prof.role === "staff")
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const token = process.env.LOYVERSE_API_TOKEN;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !svcKey)
    return NextResponse.json({ error: "환경변수 미설정" }, { status: 400 });
  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey);

  try {
    // 매장 맵 + SKU→상품ID 맵 (라인별 개별 조회 대신 일괄 로드)
    const storesRes = await lv("/stores", token);
    const storeMap: Record<string, string> = {};
    for (const s of storesRes.stores ?? []) {
      const n = (s.name as string).toLowerCase();
      storeMap[s.id] = n.includes("mcc") ? "MCC" : n.includes("moe") ? "MOE" : "WH";
    }
    // 직원 맵 (결제 담당자 표시용)
    const empMap: Record<string, string> = {};
    try {
      let ec: string | undefined;
      do {
        const ep = await lv(`/employees?limit=250${ec ? `&cursor=${ec}` : ""}`, token);
        for (const e of ep.employees ?? []) empMap[e.id] = e.name;
        ec = ep.cursor;
      } while (ec);
    } catch {
      /* 직원 조회 실패해도 동기화는 진행 */
    }

    const skuToId = new Map<string, string>();
    for (let f = 0; ; f += 1000) {
      const { data } = await db.from("products").select("id,sku").range(f, f + 999);
      (data ?? []).forEach((p) => skuToId.set(p.sku, p.id));
      if (!data || data.length < 1000) break;
    }

    // 기준 시점들
    const getSetting = async (key: string) => {
      const { data } = await db
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      return data?.value as string | undefined;
    };
    const minAllowed = backfillFrom();
    const snapshotAt = (await getSetting("loyverse_snapshot_at")) ?? minAllowed;
    const { count: existingReceipts } = await db
      .from("loyverse_receipts")
      .select("*", { count: "exact", head: true });
    // 첫 실행이면 과거까지 백필 (스냅샷 이전 건은 재고 미반영으로 기록만)
    // 무료 플랜 31일 제한을 넘지 않도록 항상 클램프
    let since =
      (existingReceipts ?? 0) === 0
        ? minAllowed
        : ((await getSetting("loyverse_last_sync")) ?? snapshotAt);
    if (since < minAllowed) since = minAllowed;

    let cursor: string | undefined;
    let receipts = 0,
      lines = 0,
      unknownSku = 0,
      backfilled = 0;

    do {
      const qs = new URLSearchParams({ created_at_min: since, limit: "250" });
      if (cursor) qs.set("cursor", cursor);
      const page = await lv(`/receipts?${qs}`, token);
      const recs = (page.receipts ?? []) as LvReceipt[];
      if (recs.length > 0) {
        const nums = recs.map((r) => r.receipt_number);
        const { data: exist } = await db
          .from("loyverse_receipts")
          .select("receipt_number")
          .in("receipt_number", nums);
        const existSet = new Set((exist ?? []).map((e) => e.receipt_number));

        const movRows: Record<string, unknown>[] = [];
        const recRows: { receipt_number: string }[] = [];
        for (const rec of recs) {
          if (existSet.has(rec.receipt_number)) continue;
          recRows.push({ receipt_number: rec.receipt_number });
          const store = storeMap[rec.store_id] ?? "MCC";
          const isRefund = rec.receipt_type === "REFUND";
          const when = rec.receipt_date ?? rec.created_at ?? new Date().toISOString();
          const applyStock = when > snapshotAt; // 스냅샷 이전 판매는 재고에 이미 반영됨
          if (!applyStock) backfilled++;
          for (const li of rec.line_items ?? []) {
            const pid = li.sku ? skuToId.get(li.sku) : undefined;
            if (!pid) {
              unknownSku++;
              continue;
            }
            const gross =
              li.gross_total_money ?? (li.price != null ? li.price * Math.abs(li.quantity) : null);
            const net = li.total_money ?? gross;
            movRows.push({
              product_id: pid,
              store,
              type: isRefund ? "return" : "sale",
              qty: Math.abs(li.quantity),
              reason: `Loyverse ${rec.receipt_number}`,
              apply_stock: applyStock,
              created_at: when, // 정산이 실제 판매 시각 기준이 되도록
              employee: (rec.employee_id && empMap[rec.employee_id]) || null,
              unit_price: li.price ?? null,
              line_total: net,
              discount:
                li.total_discount ??
                (gross != null && net != null ? Math.max(gross - net, 0) : null),
            });
            lines++;
          }
          receipts++;
        }
        for (let i = 0; i < movRows.length; i += 500) {
          const { error } = await db.from("movements").insert(movRows.slice(i, i + 500));
          if (error) throw new Error("판매 기록 실패: " + error.message);
        }
        if (recRows.length > 0)
          await db.from("loyverse_receipts").upsert(recRows, {
            onConflict: "receipt_number",
            ignoreDuplicates: true,
          });
      }
      cursor = page.cursor;
    } while (cursor);

    await db.from("app_settings").upsert([
      { key: "loyverse_last_sync", value: new Date().toISOString() },
      { key: "sync_mode", value: "api" },
    ]);
    await db.from("activity_log").insert({
      type: "system",
      summary: `Loyverse 판매 동기화: 영수증 ${receipts}건 → 판매 ${lines}건 (백필 ${backfilled}건 포함)`,
      detail: { 영수증: receipts, 판매라인: lines, 백필영수증: backfilled, 미매칭SKU: unknownSku },
      created_by: user.id,
    });

    return NextResponse.json({ ok: true, receipts, lines, unknownSku, backfilled });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
