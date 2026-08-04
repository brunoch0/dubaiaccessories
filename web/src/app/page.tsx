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
  insights: string[];
  crossAges: string[];
  crossRows: [string, number[]][]; // [국적, 연령대별 건수]
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

function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label="설명"
        className="ml-1 w-4 h-4 text-[10px] leading-4 text-center rounded-full border border-neutral-300 dark:border-neutral-600 text-neutral-400 hover:text-blue-600 hover:border-blue-500"
      >
        ?
      </button>
      {open && (
        <span
          onClick={() => setOpen(false)}
          className="absolute z-30 left-1/2 -translate-x-1/2 top-6 w-60 bg-neutral-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl font-normal normal-case cursor-pointer"
        >
          {text}
        </span>
      )}
    </span>
  );
}

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
        // ---- 교차 분석 + 인사이트 도출
        const crossAges = ["20s", "30s", "40s", "50s"];
        const natTop = cnt("nationality")
          .slice(0, 4)
          .map(([k]) => k);
        const crossRows: [string, number[]][] = natTop.map((nat) => [
          nat,
          crossAges.map(
            (a) =>
              visits.filter((v) => v.nationality === nat && v.age_group === a)
                .length
          ),
        ]);

        const insights: string[] = [];
        let combo = { nat: "", age: "", n: 0 };
        crossRows.forEach(([nat, cells]) =>
          cells.forEach((n, i) => {
            if (n > combo.n) combo = { nat, age: crossAges[i], n };
          })
        );
        if (combo.n > 0)
          insights.push(
            `핵심 고객층은 ${combo.age} ${combo.nat} — 방문 ${combo.n.toLocaleString()}건으로 가장 많습니다. 신상 셀렉션과 인스타 콘텐츠의 1순위 기준입니다.`
          );

        let bestSpend = { nat: "", avg: 0 };
        natAvg.forEach((e, k) => {
          if (e.n >= 30 && e.sum / e.n > bestSpend.avg)
            bestSpend = { nat: k, avg: e.sum / e.n };
        });
        if (bestSpend.nat)
          insights.push(
            `객단가 1위는 ${bestSpend.nat} (평균 AED ${Math.round(bestSpend.avg).toLocaleString()}) — 방문수 대비 구매력이 가장 높아 프리미엄 라인 제안 대상입니다.`
          );

        let bestRet = { nat: "", rate: 0, n: 0 };
        natTop.forEach((nat) => {
          const g = visits.filter((v) => v.nationality === nat);
          const r =
            g.filter((v) => v.visit_status === "Returning Customer").length /
            Math.max(g.length, 1);
          if (r > bestRet.rate) bestRet = { nat, rate: r, n: g.length };
        });
        if (bestRet.nat)
          insights.push(
            `재방문율 1위는 ${bestRet.nat} (${Math.round(bestRet.rate * 100)}%) — 단골 혜택·신상 알림을 가장 먼저 시도할 그룹입니다.`
          );

        const purp = cnt("purpose");
        if (purp.length > 0)
          insights.push(
            `구매 목적 1위는 '${purp[0][0]}' (전체의 ${Math.round((purp[0][1] / visits.length) * 100)}%) — 선물 포장·기념일 프로모션이 매출로 직결되는 구조입니다.`
          );

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
          insights,
          crossAges,
          crossRows,
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

  const tile = (label: string, value: string, cls = "", help?: string) => (
    <div
      key={label}
      className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"
    >
      <div className="text-xs text-neutral-500">
        {label}
        {help && <Help text={help} />}
      </div>
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
              {tile(
                "등록 상품",
                fmt(s.products) + "개",
                "",
                "시스템에 등록된 전체 상품 종류 수입니다 (SKU 기준). 수량이 아니라 품목 수예요."
              )}
              {tile(
                "MCC 재고",
                fmt(s.mcc) + "개",
                "",
                "Mirdif City Centre 매장에 있는 모든 상품 수량의 합계입니다."
              )}
              {tile(
                "MOE 재고",
                fmt(s.moe) + "개",
                "",
                "Mall of the Emirates 매장에 있는 모든 상품 수량의 합계입니다."
              )}
              {tile(
                "품절 상품",
                fmt(s.soldout) + "개",
                "",
                "두 매장 재고를 합쳐도 0개 이하인 상품 수입니다. 보충하거나 판매 종료 처리할 후보예요."
              )}
              {tile(
                "마이너스 재고",
                s.negatives + "건",
                s.negatives > 0 ? "!text-red-600" : "",
                "기록상 재고가 음수(-)인 항목 — 실물과 기록이 어긋났다는 신호입니다. 해당 품목만 실물을 세서 실사 반영하면 해결됩니다."
              )}
            </div>
            {s.costValue !== null && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                {tile(
                  "재고 원가액 (오너/관리자)",
                  "AED " + fmt(Math.round(s.costValue)),
                  "",
                  "남아있는 모든 재고를 매입 원가로 환산한 금액 — 지금 재고에 묶여 있는 돈입니다."
                )}
                {tile(
                  "재고 판매가액 (오너/관리자)",
                  "AED " + fmt(Math.round(s.priceValue ?? 0)),
                  "",
                  "남은 재고를 전부 정가에 판매했을 때의 예상 매출액입니다. 원가액과의 차이가 잠재 마진이에요."
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                  카테고리별 상품 수 — 상위 10
                  <Help text="카테고리마다 등록된 상품 종류가 몇 개인지입니다. 어느 카테고리에 상품이 몰려 있는지 볼 수 있어요." />
                </h2>
                {bars(s.catCounts)}
              </section>
              <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                  매장별 재고 수량
                  <Help text="매장별로 갖고 있는 총 수량 비교입니다. 한쪽에 치우치면 매장 간 이동을 검토할 수 있어요." />
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
                  {tile(
                    "방문 기록",
                    fmt(cs.total) + "건",
                    "",
                    "고객 정보가 기록된 구매 방문 건수입니다 (영수증 기준, 중복 제거)."
                  )}
                  {tile(
                    "재방문율",
                    cs.returningRate + "%",
                    "",
                    "방문 기록 중 '재방문 고객'으로 표시된 비율입니다. 높을수록 단골이 많다는 뜻 — 온라인 쇼핑몰 오픈 시 1차 타겟이에요."
                  )}
                  {tile(
                    "평균 객단가",
                    "AED " + fmt(cs.avgAmount),
                    "",
                    "방문 1회당 평균 구매 금액입니다. 가격 정책·무료배송 기준선을 정할 때 참고하는 숫자예요."
                  )}
                </div>
                {cs.insights.length > 0 && (
                  <div className="mt-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                      🔎 인사이트
                      <Help text="아래 방문 데이터에서 자동으로 도출한 요점입니다. 판매 데이터가 쌓이면 카테고리·시즌 인사이트로 확장됩니다." />
                    </h3>
                    <ul className="space-y-1.5 text-sm text-neutral-700 dark:text-neutral-200">
                      {cs.insights.map((t) => (
                        <li key={t} className="flex gap-2">
                          <span className="text-blue-500">▸</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="text-neutral-500">
                            <th className="text-left py-1 pr-3">국적 \ 연령</th>
                            {cs.crossAges.map((a) => (
                              <th key={a} className="text-right py-1 px-2">
                                {a}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cs.crossRows.map(([nat, cells]) => {
                            const max = Math.max(
                              ...cs.crossRows.flatMap(([, c]) => c),
                              1
                            );
                            return (
                              <tr key={nat}>
                                <td className="py-1 pr-3 text-neutral-600 dark:text-neutral-300">
                                  {nat}
                                </td>
                                {cells.map((n, i) => (
                                  <td
                                    key={i}
                                    className="text-right py-1 px-2 tabular-nums"
                                    style={{
                                      backgroundColor: `rgba(42,120,214,${(n / max) * 0.35})`,
                                    }}
                                  >
                                    {n.toLocaleString()}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-neutral-400 mt-1.5">
                        진하게 칠해질수록 방문이 많은 조합 (상위 4개 국적 × 연령대)
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid md:grid-cols-2 gap-4 mt-3">
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                      연령대 분포
                      <Help text="방문 시 직원이 기록한 고객 연령대 분포입니다. 인스타 광고 타겟팅에 그대로 쓸 수 있어요." />
                    </h3>
                    {bars(cs.ages)}
                  </div>
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
                      국적 분포 · 국적별 평균 객단가
                      <Help text="어느 국적 고객이 많이 오는지(막대)와, 그 고객군이 평균 얼마를 쓰는지(Ø 금액)입니다. 방문은 적어도 객단가가 높은 그룹이 VIP 후보예요." />
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
                    <Help text="직원이 기록한 구매 목적별 건수입니다. 선물 비중이 높으면 기프트 포장·시즌 프로모션의 근거가 됩니다." />
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
                <Help text="시스템이 발견한, 기록과 실물의 차이를 줄이기 위한 작업 목록입니다. 처리할수록 재고 숫자가 정확해집니다." />
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
