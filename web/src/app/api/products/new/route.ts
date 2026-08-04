import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const LV_BASE = "https://api.loyverse.com/v1.0";

async function lv(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${LV_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Loyverse API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "로그인 필요" }, { status: 401 }) };
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!prof || prof.role === "staff")
    return { error: NextResponse.json({ error: "권한 없음" }, { status: 403 }) };
  return { user };
}

function ean13CheckDigit(d12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

// 카테고리명에서 코드 추출: "1 Earring"/"01 Earring" → "01", "5 Anklet Etc" → "05"
function catCode(name: string): string {
  const m = name.trim().match(/^(\d{1,2})/);
  return m ? m[1].padStart(2, "0") : "05";
}

// 폼용: Loyverse 카테고리·매장 목록
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const token = process.env.LOYVERSE_API_TOKEN;
  if (!token)
    return NextResponse.json({ error: "LOYVERSE_API_TOKEN 미설정" }, { status: 400 });
  try {
    const cats: { id: string; name: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await lv(
        `/categories?limit=250${cursor ? `&cursor=${cursor}` : ""}`,
        token
      );
      for (const c of page.categories ?? []) cats.push({ id: c.id, name: c.name });
      cursor = page.cursor;
    } while (cursor);
    cats.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ ok: true, categories: cats });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const token = process.env.LOYVERSE_API_TOKEN;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !svcKey)
    return NextResponse.json({ error: "환경변수 미설정" }, { status: 400 });
  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey);

  try {
    const body = await req.json();
    const {
      name,
      description = "",
      category_id,
      category_name,
      price,
      cost,
      qty = {},
      vat = true,
    } = body as {
      name: string;
      description?: string;
      category_id: string;
      category_name: string;
      price: number;
      cost: number | null;
      qty: Record<string, number>;
      vat?: boolean;
    };
    if (!name?.trim() || !category_id || !price)
      return NextResponse.json({ error: "이름/카테고리/가격은 필수" }, { status: 400 });

    // 1) SKU 자동 채번: YYMMDD(두바이 기준) + 카테고리코드2 + 순번2
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dubai",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replace(/-/g, "");
    const prefix = ymd + catCode(category_name);
    const { data: last } = await db
      .from("products")
      .select("sku")
      .like("sku", prefix + "%")
      .order("sku", { ascending: false })
      .limit(1);
    const seq = last && last.length > 0 ? parseInt(last[0].sku.slice(-2), 10) + 1 : 1;
    if (seq > 99)
      return NextResponse.json(
        { error: "오늘 이 카테고리 순번(99)이 가득 찼습니다" },
        { status: 400 }
      );
    const sku = prefix + String(seq).padStart(2, "0");
    const b12 = "20" + sku; // 기존 규칙: '20' + 10자리 SKU + 체크숫자 = 13자리
    const barcode = b12 + ean13CheckDigit(b12);

    // 2) VAT 세금 ID 조회 (토글 ON일 때)
    let taxIds: string[] | undefined;
    if (vat) {
      try {
        const taxRes = await lv("/taxes", token);
        const t = (taxRes.taxes ?? []).find(
          (x: { name: string; rate: number }) =>
            /vat/i.test(x.name) || x.rate === 5
        );
        if (t) taxIds = [t.id];
      } catch {
        /* 세금 조회 실패해도 상품 등록은 진행 */
      }
    }

    // 3) Loyverse에 상품 생성 (tax_ids 미지원 응답이면 없이 재시도)
    const itemPayload = {
      item_name: name.trim(),
      category_id,
      description: description || undefined,
      track_stock: true,
      tax_ids: taxIds,
      variants: [
        {
          sku,
          barcode,
          cost: cost ?? undefined,
          default_pricing_type: "FIXED",
          default_price: price,
        },
      ],
    };
    let lvItem;
    try {
      lvItem = await lv("/items", token, {
        method: "POST",
        body: JSON.stringify(itemPayload),
      });
    } catch (err) {
      if (taxIds) {
        lvItem = await lv("/items", token, {
          method: "POST",
          body: JSON.stringify({ ...itemPayload, tax_ids: undefined }),
        });
      } else throw err;
    }
    const variantId = lvItem.variants?.[0]?.variant_id as string | undefined;

    // 3) 초기 재고를 Loyverse에 설정
    const storesRes = await lv("/stores", token);
    const nameToStoreId: Record<string, string> = {};
    for (const s of storesRes.stores ?? []) {
      const n = (s.name as string).toLowerCase();
      const key = n.includes("mcc") ? "MCC" : n.includes("moe") ? "MOE" : "WH";
      nameToStoreId[key] = s.id;
    }
    const levels = Object.entries(qty)
      .filter(([k, v]) => v > 0 && nameToStoreId[k] && variantId)
      .map(([k, v]) => ({
        variant_id: variantId,
        store_id: nameToStoreId[k],
        stock_after: v,
      }));
    if (levels.length > 0)
      await lv("/inventory", token, {
        method: "POST",
        body: JSON.stringify({ inventory_levels: levels }),
      });

    // 4) 우리 DB 반영
    const { data: inserted, error: pErr } = await db
      .from("products")
      .insert({
        sku,
        name: name.trim(),
        category: category_name,
        price,
        barcode,
        flag: "시스템 등록",
      })
      .select("id")
      .single();
    if (pErr) throw new Error("DB 반영 실패: " + pErr.message);
    await db.from("product_costs").upsert({ product_id: inserted.id, cost });
    const invRows = Object.entries(qty)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ product_id: inserted.id, store: k, qty: v }));
    if (invRows.length)
      await db.from("inventory").upsert(invRows, { onConflict: "product_id,store" });
    await db.from("activity_log").insert({
      type: "product_new",
      summary: `상품 등록: ${name.trim()} (${sku})`,
      detail: { sku, barcode, price, qty },
      created_by: auth.user.id,
    });

    return NextResponse.json({ ok: true, sku, barcode, product_id: inserted.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
