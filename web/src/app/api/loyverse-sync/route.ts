import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const LV_BASE = "https://api.loyverse.com/v1.0";

type LvReceipt = {
  receipt_number: string;
  receipt_type: string; // SALE | REFUND
  store_id: string;
  line_items?: { sku?: string; quantity: number }[];
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
  // 1) 로그인 세션 확인 (관리자/오너만)
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

  // 2) 환경변수 확인
  const token = process.env.LOYVERSE_API_TOKEN;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token)
    return NextResponse.json(
      { error: "LOYVERSE_API_TOKEN 미설정 — Vercel 환경변수에 추가 필요" },
      { status: 400 }
    );
  if (!svcKey)
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY 미설정 — Vercel 환경변수에 추가 필요" },
      { status: 400 }
    );
  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey);

  try {
    // 3) 매장 매핑 (Loyverse store name → MCC/MOE/WH)
    const storesRes = await lv("/stores", token);
    const storeMap: Record<string, string> = {};
    for (const s of storesRes.stores ?? []) {
      const n = (s.name as string).toLowerCase();
      storeMap[s.id] =
        n.includes("mcc") ? "MCC" : n.includes("moe") ? "MOE" : "WH";
    }

    // 4) 마지막 동기화 시점 이후 영수증 수집
    const { data: ls } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "loyverse_last_sync")
      .maybeSingle();
    const since = ls?.value ?? "2026-07-22T00:00:00.000Z"; // 시딩 기준일

    let cursor: string | undefined;
    let receipts = 0,
      lines = 0,
      unknownSku = 0;

    do {
      const qs = new URLSearchParams({ created_at_min: since, limit: "250" });
      if (cursor) qs.set("cursor", cursor);
      const page = await lv(`/receipts?${qs}`, token);

      for (const rec of (page.receipts ?? []) as LvReceipt[]) {
        // 멱등성: 이미 반영한 영수증은 건너뜀
        const { error: dup } = await db
          .from("loyverse_receipts")
          .insert({ receipt_number: rec.receipt_number });
        if (dup) continue;

        const store = storeMap[rec.store_id] ?? "MCC";
        const isRefund = rec.receipt_type === "REFUND";
        for (const li of rec.line_items ?? []) {
          if (!li.sku) {
            unknownSku++;
            continue;
          }
          // ponytail: 라인별 개별 조회 — 판매량 커지면 배치 조회로
          const { data: p } = await db
            .from("products")
            .select("id")
            .eq("sku", li.sku)
            .maybeSingle();
          if (!p) {
            unknownSku++;
            continue;
          }
          await db.from("movements").insert({
            product_id: p.id,
            store,
            type: isRefund ? "return" : "sale",
            qty: Math.abs(li.quantity),
            reason: `Loyverse ${rec.receipt_number}`,
          });
          lines++;
        }
        receipts++;
      }
      cursor = page.cursor;
    } while (cursor);

    // 5) 상태 갱신: 마지막 동기화 시점 + API 모드 전환 + 활동 기록
    await db.from("app_settings").upsert([
      { key: "loyverse_last_sync", value: new Date().toISOString() },
      { key: "sync_mode", value: "api" },
    ]);
    await db.from("activity_log").insert({
      type: "system",
      summary: `Loyverse 동기화: 영수증 ${receipts}건 → 판매 ${lines}건 반영`,
      detail: { 영수증: receipts, 판매라인: lines, 미매칭SKU: unknownSku },
      created_by: user.id,
    });

    return NextResponse.json({ ok: true, receipts, lines, unknownSku });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
