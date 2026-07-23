"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Inv = { product_id: string; store: string; qty: number };
type Prod = { id: string; category: string; price: number | null };
type Cost = { product_id: string; cost: number | null };
type Visit = {
  visit_status: string | null;
  age_group: string | null;
  nationality: string | null;
  purpose: string | null;
  amount: number | null;
};

type CustomerStats = {
  total: number;
  returningRate: number;
  avgAmount: number;
  ages: [string, number][];
  nats: [string, number, number][]; // [국적, 건수, 평균객단가]
  purposes: [string, number][];
};

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
  const [cs, setCs] = useState<CustomerStats | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [prods, inv, costs, visits] = await Promise.all([
        fetchAll<Prod>(supabase, "products", "id,category,price"),
        fetchAll<Inv>(supabase, "inventory", "product_id,store,qty"),
        fetchAll<Cost>(supabase, "product_costs", "product_id,cost"),
        fetchAll<Visit>(
          supabase,
          "customer_visits",
          "visit_status,age_group,nationality,purpose,amount"
        ),
      ]);

      if (visits.length > 0) {
        const returning = visits.filter(
          (v) => v.visit_status === "Returning Customer"
        ).length;
        const amts = visits.filter((v) => v.amount != null) as (Visit & {
          amount: number;
        })[];
        const cnt = (key: "age_group" | "nationality" | "purpose") => {
          const m = new Map<string, number>();
          visits.forEach((v) => {
            const k = v[key];
            if (k) m.set(k, (m.get(k) ?? 0) + 1);
          });
          return [...m.entries()].sort((a, b) => b[1] - a[1]);
        };
        const natAvg = new Map<string, { sum: number; n: number }>();
        amts.forEach((v) => {
          if (!v.nationality) return;
          const e = natAvg.get(v.nationality) ?? { sum: 0, n: 0 };
          e.sum += v.amount;
          e.n++;
          natAvg.set(v.nationality, e);
        });
        setCs({
          total: visits.length,
          returningRate: Math.round((returning / visits.length) * 100),
          avgAmount: Math.round(
            amts.reduce((a, v) => a + v.amount, 0) / Math.max(amts.length, 1)
          ),
          ages: cnt("age_group").slice(0, 6),
          nats: cnt("nationality")
            .slice(0, 6)
            .map(([k, n]) => {
              const e = natAvg.get(k);
              return [k, n, e ? Math.round(e.sum / e.n) : 0] as [
                string,
                number,
                number
              ];
            }),
          purposes: cnt("purpose").slice(0, 6),
        });
      }

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

            {cs && (
              <section className="mt-6">
                <h2 className="text-base font-bold text-neutral-900 dark:text-white mb-3">
                  👥 고객 분석{" "}
                  <span className="text-xs font-normal text-neutral-400">
                    오너/관리자 전용 · 매장 방문기록 기반
                  </span>
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {tile("방문 기록", fmt(cs.total) + "건")}
                  {tile("재방문율", cs.returningRate + "%")}
                  {tile("평균 객단가", "AED " + fmt(cs.avgAmount))}
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-3">
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                      연령대 분포
                    </h3>
                    {bars(cs.ages)}
                  </div>
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                      국적 분포 · 국적별 평균 객단가
                    </h3>
                    <div className="space-y-1.5">
                      {cs.nats.map(([nat, n, avg]) => {
                        const max = cs.nats[0][1];
                        return (
                          <div
                            key={nat}
                            className="grid grid-cols-[90px_1fr_120px] items-center gap-2"
                          >
                            <div className="text-xs text-neutral-500 text-right truncate">
                              {nat}
                            </div>
                            <div className="h-4">
                              <div
                                className="h-4 bg-blue-600 dark:bg-blue-500 rounded-r"
                                style={{
                                  width: `${Math.max((n / max) * 100, 1)}%`,
                                }}
                              />
                            </div>
                            <div className="text-xs text-neutral-500 tabular-nums">
                              {fmt(n)}건 · Ø AED {fmt(avg)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 mt-3">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                    구매 목적 상위
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {cs.purposes.map(([p, n]) => (
                      <span
                        key={p}
                        className="rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 text-xs px-3 py-1.5"
                      >
                        {p} <b>{fmt(n)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}

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
