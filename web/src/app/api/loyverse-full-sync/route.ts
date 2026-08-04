import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const LV_BASE = "https://api.loyverse.com/v1.0";

async function lv(path: string, token: string) {
  const res = await fetch(`${LV_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Loyverse API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function* paged(path: string, listKey: string, token: string) {
  let cursor: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await lv(
      `${path}${sep}limit=250${cursor ? `&cursor=${cursor}` : ""}`,
      token
    );
    yield* (page[listKey] ?? []) as Record<string, unknown>[];
    cursor = page.cursor as string | undefined;
  } while (cursor);
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
    return NextResponse.json(
      { error: "LOYVERSE_API_TOKEN / SUPABASE_SERVICE_ROLE_KEY 환경변수 필요" },
      { status: 400 }
    );
  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey);

  try {
    // 1) 카테고리 & 매장 맵
    const catMap: Record<string, string> = {};
    for await (const c of paged("/categories", "categories", token))
      catMap[c.id as string] = c.name as string;

    const storeMap: Record<string, string> = {};
    const storesRes = await lv("/stores", token);
    for (const s of storesRes.stores ?? []) {
      const n = (s.name as string).toLowerCase();
      storeMap[s.id] = n.includes("mcc") ? "MCC" : n.includes("moe") ? "MOE" : "WH";
    }

    // 2) 상품 전체 (variants → sku 단위)
    type Row = {
      sku: string;
      name: string;
      category: string;
      price: number | null;
      cost: number | null;
      barcode: string;
      image_url: string | null;
    };
    const rows: Row[] = [];
    const variantToSku: Record<string, string> = {};
    for await (const item of paged("/items", "items", token)) {
      const category = catMap[item.category_id as string] ?? "99 미분류";
      for (const v of (item.variants ?? []) as Record<string, unknown>[]) {
        const sku = ((v.sku as string) ?? "").trim();
        if (!sku) continue;
        variantToSku[v.variant_id as string] = sku;
        const storesArr = (v.stores ?? []) as { price: number | null }[];
        rows.push({
          sku,
          name: (item.item_name as string) ?? sku,
          category,
          price: storesArr.find((s) => s.price != null)?.price ?? (v.default_price as number | null),
          cost: (v.cost as number | null) ?? null,
          barcode: ((v.barcode as string) ?? "").trim(),
          image_url: (item.image_url as string | null) ?? null,
        });
      }
    }

    // 3) products upsert (sku 기준) + costs
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db.from("products").upsert(
        chunk.map((r) => ({
          sku: r.sku,
          name: r.name,
          category: r.category,
          price: r.price,
          barcode: r.barcode,
          image_url: r.image_url,
        })),
        { onConflict: "sku" }
      );
      if (error) throw new Error("상품 반영 실패: " + error.message);
    }
    // sku → id 맵
    const skuToId = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("products").select("id,sku").range(from, from + 999);
      (data ?? []).forEach((p) => skuToId.set(p.sku, p.id));
      if (!data || data.length < 1000) break;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows
        .slice(i, i + 500)
        .filter((r) => skuToId.has(r.sku))
        .map((r) => ({ product_id: skuToId.get(r.sku)!, cost: r.cost }));
      if (chunk.length) await db.from("product_costs").upsert(chunk);
    }

    // 4) 재고 레벨 전체
    let invRows = 0;
    const invBuf: { product_id: string; store: string; qty: number }[] = [];
    for await (const lvl of paged("/inventory", "inventory_levels", token)) {
      const sku = variantToSku[lvl.variant_id as string];
      const pid = sku ? skuToId.get(sku) : undefined;
      const store = storeMap[lvl.store_id as string];
      if (!pid || !store) continue;
      invBuf.push({ product_id: pid, store, qty: Math.trunc(lvl.in_stock as number) });
    }
    for (let i = 0; i < invBuf.length; i += 500) {
      const { error } = await db
        .from("inventory")
        .upsert(invBuf.slice(i, i + 500), { onConflict: "product_id,store" });
      if (error) throw new Error("재고 반영 실패: " + error.message);
      invRows += Math.min(500, invBuf.length - i);
    }

    // 5) 기준 시점 갱신 — 이후 판매 동기화는 지금부터
    await db.from("app_settings").upsert([
      { key: "loyverse_last_sync", value: new Date().toISOString() },
      { key: "sync_mode", value: "api" },
    ]);
    await db.from("activity_log").insert({
      type: "system",
      summary: `Loyverse 전체 데이터 새로고침: 상품 ${rows.length}개, 재고 ${invRows}행`,
      detail: { 상품: rows.length, 재고행: invRows, 카테고리: Object.keys(catMap).length },
      created_by: user.id,
    });

    return NextResponse.json({ ok: true, products: rows.length, inventory: invRows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
