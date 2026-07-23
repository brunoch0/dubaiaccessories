"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Inv = { product_id: string; store: string; qty: number };
type Prod = { id: string; category: string; price: number | null };
type Cost = { product_id: string; cost: number | null };

type Stats = {
  products: number;
  mcc: number;
  moe: number;
  negatives: number;
  soldout: number;
  costValue: number | null;
  priceValue: number | null;
  catCounts: [string, number][];
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [prods, inv, costs] = await Promise.all([
        fetchAll<Prod>(supabase, "products", "id,category,price"),
        fetchAll<Inv>(supabase, "inventory", "product_id,store,qty"),
        fetchAll<Cost>(supabase, "product_costs", "product_id,cost"),
      ]);

      const mcc = inv.filter((r) => r.store === "MCC").reduce((a, r) => a + r.qty, 0);
      const moe = inv.filter((r) => r.store === "MOE").reduce((a, r) => a + r.qty, 0);
      const negatives = inv.filter((r) => r.qty < 0).length;

      const qtyByProduct = new Map<string, number>();
      inv.forEach((r) =>
        qtyByProduct.set(r.product_id, (qtyByProduct.get(r.product_id) ?? 0) + r.qty)
      );
      const soldout = prods.filter((p) => (qtyByProduct.get(p.id) ?? 0) <= 0).length;

      let costValue: number | null = null;
      if (costs.length > 0) {
        const costMap = new Map(costs.map((c) => [c.product_id, c.cost ?? 0]));
        costValue = 0;
        qtyByProduct.forEach((qty, pid) => {
          if (qty > 0) costValue! += (costMap.get(pid) ?? 0) * qty;
        });
      }
      let priceValue: number | null = null;
      if (costs.length > 0) {
        const priceMap = new Map(prods.map((p) => [p.id, p.price ?? 0]));
        priceValue = 0;
        qtyByProduct.forEach((qty, pid) => {
          if (qty > 0) priceValue! += (priceMap.get(pid) ?? 0) * qty;
        });
      }

      const byCat = new Map<string, number>();
      prods.forEach((p) => byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1));
      const catCounts = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

      setS({
        products: prods.length,
        mcc,
        moe,
        negatives,
        soldout,
        costValue,
        priceValue,
        catCounts,
      });
    })();
  }, []);

  const tile = (label: string, value: string, cls = "") => (
    <div
      key={label}
      className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 text-neutral-900 dark:text-white ${cls}`}>
        {value}
      </div>
    </div>
  );

  const bars = (rows: [string, number][]) => {
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return (
      <div className="space-y-1.5">
        {rows.map(([label, v]) => (
          <div key={label} className="grid grid-cols-[130px_1fr_60px] items-center gap-2">
            <div
              className="text-xs text-neutral-500 text-right truncate"
              title={label}
            >
              {label}
            </div>
            <div className="h-4">
              <div
                className="h-4 bg-blue-600 dark:bg-blue-500 rounded-r"
                style={{ width: `${Math.max((v / max) * 100, 1)}%` }}
              />
            </div>
            <div className="text-xs text-neutral-500 tabular-nums">{fmt(v)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white mb-4">
          대시보드
        </h1>
        {!s ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {tile("등록 상품", fmt(s.products) + "개")}
              {tile("MCC 재고", fmt(s.mcc) + "개")}
              {tile("MOE 재고", fmt(s.moe) + "개")}
              {tile("품절 상품", fmt(s.soldout) + "개")}
              {tile(
                "마이너스 재고",
                s.negatives + "건",
                s.negatives > 0 ? "!text-red-600" : ""
              )}
            </div>
            {s.costValue !== null && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                {tile("재고 원가액 (오너/관리자)", "AED " + fmt(Math.round(s.costValue)))}
                {tile(
                  "재고 판매가액 (오너/관리자)",
                  "AED " + fmt(Math.round(s.priceValue ?? 0))
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                  카테고리별 상품 수 — 상위 10
                </h2>
                {bars(s.catCounts)}
              </section>
              <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                  매장별 재고 수량
                </h2>
                {bars([
                  ["MCC", s.mcc],
                  ["MOE", s.moe],
                ])}
                <p className="text-xs text-neutral-400 mt-3">
                  창고(WareHouse)는 로케이션만 등록된 상태 (수량 0)
                </p>
                <div className="mt-5 flex gap-2">
                  <Link
                    href="/inventory"
                    className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2"
                  >
                    재고 조회 →
                  </Link>
                  <Link
                    href="/inventory?status=neg"
                    className="rounded-lg border border-red-300 dark:border-red-900 text-red-600 text-sm font-semibold px-4 py-2 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    마이너스 {s.negatives}건
                  </Link>
                </div>
              </section>
            </div>

            <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 mt-4">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                오늘 할 일 (데이터 품질)
              </h2>
              <ul className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1.5">
                <li>
                  ⚠️ 마이너스 재고 <b className="text-red-600">{s.negatives}건</b> — 실물
                  확인 후 정산 필요
                </li>
                <li>
                  📦 품절(재고 0 이하) 상품 <b>{fmt(s.soldout)}개</b> — 보충 또는 품절
                  처리 판단
                </li>
                <li>
                  🏷️ 카테고리 {s.catCounts.length >= 10 ? "17종 → 5종 정리" : "정리"} 예정
                  — 파트너 합의 후 일괄 적용
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
