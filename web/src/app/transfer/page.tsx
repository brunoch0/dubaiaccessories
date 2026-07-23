"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Row = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number | null;
  mcc: number;
  moe: number;
  from: "MCC" | "MOE";
  to: "MCC" | "MOE";
  moveQty: number;
};

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

export default function TransferPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dir, setDir] = useState<"" | "toMCC" | "toMOE">("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [prods, inv] = await Promise.all([
        fetchAll<{
          id: string;
          sku: string;
          name: string;
          category: string;
          price: number | null;
        }>(supabase, "products", "id,sku,name,category,price"),
        fetchAll<{ product_id: string; store: string; qty: number }>(
          supabase,
          "inventory",
          "product_id,store,qty"
        ),
      ]);
      const stock = new Map<string, { mcc: number; moe: number }>();
      inv.forEach((r) => {
        const e = stock.get(r.product_id) ?? { mcc: 0, moe: 0 };
        if (r.store === "MCC") e.mcc = r.qty;
        else if (r.store === "MOE") e.moe = r.qty;
        stock.set(r.product_id, e);
      });
      const out: Row[] = [];
      prods.forEach((p) => {
        const s = stock.get(p.id) ?? { mcc: 0, moe: 0 };
        // 한쪽 품절 + 다른 쪽 2개 이상 → 이동 추천 (여유의 절반, 최소 1개)
        if (s.mcc <= 0 && s.moe >= 2) {
          out.push({
            ...p,
            mcc: s.mcc,
            moe: s.moe,
            from: "MOE",
            to: "MCC",
            moveQty: Math.max(1, Math.floor(s.moe / 2)),
          });
        } else if (s.moe <= 0 && s.mcc >= 2) {
          out.push({
            ...p,
            mcc: s.mcc,
            moe: s.moe,
            from: "MCC",
            to: "MOE",
            moveQty: Math.max(1, Math.floor(s.mcc / 2)),
          });
        }
      });
      // 판매가 높은 순 = 기회 큰 순
      out.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      setRows(out);
    })();
  }, []);

  const filtered = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        dir === "" ? true : dir === "toMCC" ? r.to === "MCC" : r.to === "MOE"
      ),
    [rows, dir]
  );

  const oppValue = filtered.reduce(
    (a, r) => a + (r.price ?? 0) * r.moveQty,
    0
  );

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white">
          매장간 이동 추천
        </h1>
        <p className="text-sm text-neutral-500 mt-1 mb-4">
          한쪽 매장은 품절인데 다른 매장에 재고가 있는 상품 — 옮기면 판매 기회가
          생깁니다. 판매가 높은 순.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(
            [
              ["", "전체"],
              ["toMCC", "→ MCC로 보낼 것"],
              ["toMOE", "→ MOE로 보낼 것"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setDir(v)}
              className={`px-4 py-1.5 rounded-full text-sm ${
                dir === v
                  ? "bg-blue-600 text-white font-semibold"
                  : "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {label}
            </button>
          ))}
          {rows && (
            <span className="ml-auto text-sm text-neutral-500">
              {filtered.length}건 · 이동 시 판매 기회{" "}
              <b className="text-neutral-900 dark:text-white">
                AED {fmt(Math.round(oppValue))}
              </b>
            </span>
          )}
        </div>

        {!rows ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-neutral-500">추천 항목이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm bg-white dark:bg-neutral-950">
              <thead>
                <tr className="bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500">
                  <th className="px-3 py-2 text-left">상품</th>
                  <th className="px-3 py-2 text-left">카테고리</th>
                  <th className="px-3 py-2 text-right">판매가</th>
                  <th className="px-3 py-2 text-right">MCC</th>
                  <th className="px-3 py-2 text-right">MOE</th>
                  <th className="px-3 py-2 text-left">추천</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 dark:border-neutral-900"
                  >
                    <td className="px-3 py-2">
                      <div className="text-neutral-900 dark:text-white">{r.name}</div>
                      <div className="text-[11px] text-neutral-400">SKU {r.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">
                      {r.category}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.mcc <= 0 ? "text-red-600 font-semibold" : ""
                      }`}
                    >
                      {r.mcc}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.moe <= 0 ? "text-red-600 font-semibold" : ""
                      }`}
                    >
                      {r.moe}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-block rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-semibold px-3 py-1">
                        {r.from} → {r.to} {r.moveQty}개
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
