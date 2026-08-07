"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import Help from "@/components/Help";
import { createClient, fetchAll } from "@/lib/supabase";

type Mov = {
  product_id: string;
  store: string;
  type: "sale" | "return";
  qty: number;
  reason: string | null;
  created_at: string;
  line_total: number | null;
};
type Prod = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number | null;
  image_url: string | null;
};
type Inv = { product_id: string; store: string; qty: number };
type Cost = { product_id: string; cost: number | null };

const fmt = (n: number) => n.toLocaleString("en-US");
const VELOCITY_DAYS = 21; // 판매속도 계산 기준

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover bg-neutral-100 dark:bg-neutral-800" />
  ) : (
    <span className="w-9 h-9 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-300 text-xs flex items-center justify-center">✦</span>
  );
}

const card = "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5";
const thCls = "px-3 py-2 text-xs text-neutral-500 whitespace-nowrap";
const tdCls = "px-3 py-1.5 whitespace-nowrap tabular-nums";

export default function AnalyticsPage() {
  const [role, setRole] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [prods, setProds] = useState<Prod[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  const [recCust, setRecCust] = useState<Map<string, string>>(new Map());
  const [bestBy, setBestBy] = useState<"qty" | "net">("net");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole(data?.role ?? "staff");
    });
    (async () => {
      const [p, i, c] = await Promise.all([
        fetchAll<Prod>(supabase, "products", "id,sku,name,category,price,image_url"),
        fetchAll<Inv>(supabase, "inventory", "product_id,store,qty"),
        fetchAll<Cost>(supabase, "product_costs", "product_id,cost"),
      ]);
      setProds(p);
      setInv(i);
      setCosts(new Map(c.map((x) => [x.product_id, x.cost ?? 0])));
      // 판매 기록: 최근 30일
      const fromIso = new Date(Date.now() - 30 * 86400_000).toISOString();
      const all: Mov[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await supabase
          .from("movements")
          .select("product_id,store,type,qty,reason,created_at,line_total")
          .in("type", ["sale", "return"])
          .gte("created_at", fromIso)
          .range(f, f + 999);
        if (error || !data) break;
        all.push(...(data as Mov[]));
        if (data.length < 1000) break;
      }
      setMovs(all);
      // 고객 맵 (admin 전용 테이블 — staff는 빈 결과)
      const m = new Map<string, string>();
      for (let f = 0; ; f += 1000) {
        const { data, error } = await supabase
          .from("loyverse_receipts")
          .select("receipt_number,customer")
          .range(f, f + 999);
        if (error || !data) break;
        data.forEach((r) => r.customer && m.set(r.receipt_number, r.customer));
        if (data.length < 1000) break;
      }
      setRecCust(m);
    })();
  }, []);

  const pMap = useMemo(() => new Map(prods.map((p) => [p.id, p])), [prods]);
  const stockMap = useMemo(() => {
    const m = new Map<string, { total: number; mcc: number; moe: number }>();
    inv.forEach((r) => {
      const e = m.get(r.product_id) ?? { total: 0, mcc: 0, moe: 0 };
      e.total += r.qty;
      if (r.store === "MCC") e.mcc += r.qty;
      if (r.store === "MOE") e.moe += r.qty;
      m.set(r.product_id, e);
    });
    return m;
  }, [inv]);

  const analysis = useMemo(() => {
    if (!movs) return null;
    const periodFrom = Date.now() - days * 86400_000;
    const velFrom = Date.now() - VELOCITY_DAYS * 86400_000;

    type Agg = { qty: number; net: number; mcc: number; moe: number; velQty: number };
    const byProd = new Map<string, Agg>();
    const byCust = new Map<string, { net: number; recs: Set<string>; last: string }>();
    let totalNet = 0,
      totalQty = 0;

    movs.forEach((m) => {
      const t = new Date(m.created_at).getTime();
      const sign = m.type === "return" ? -1 : 1;
      const p = pMap.get(m.product_id);
      const net = sign * (m.line_total ?? (p?.price ?? 0) * m.qty);

      const a = byProd.get(m.product_id) ?? { qty: 0, net: 0, mcc: 0, moe: 0, velQty: 0 };
      if (t >= periodFrom) {
        a.qty += sign * m.qty;
        a.net += net;
        if (m.store === "MCC") a.mcc += sign * m.qty;
        if (m.store === "MOE") a.moe += sign * m.qty;
        totalNet += net;
        totalQty += sign * m.qty;
      }
      if (t >= velFrom) a.velQty += sign * m.qty;
      byProd.set(m.product_id, a);

      // 고객 집계 (기간 내)
      if (t >= periodFrom && m.reason?.startsWith("Loyverse ")) {
        const cust = recCust.get(m.reason.replace("Loyverse ", ""));
        if (cust) {
          const e = byCust.get(cust) ?? { net: 0, recs: new Set<string>(), last: m.created_at };
          e.net += net;
          e.recs.add(m.reason);
          if (m.created_at > e.last) e.last = m.created_at;
          byCust.set(cust, e);
        }
      }
    });

    // 베스트셀러
    const best = [...byProd.entries()]
      .filter(([, a]) => a.qty > 0)
      .sort((x, y) => (bestBy === "qty" ? y[1].qty - x[1].qty : y[1].net - x[1].net))
      .slice(0, 20);

    // 카테고리
    const byCat = new Map<string, { qty: number; net: number }>();
    byProd.forEach((a, pid) => {
      const cat = pMap.get(pid)?.category ?? "?";
      const e = byCat.get(cat) ?? { qty: 0, net: 0 };
      e.qty += a.qty;
      e.net += a.net;
      byCat.set(cat, e);
    });
    const cats = [...byCat.entries()].filter(([, e]) => e.net > 0).sort((x, y) => y[1].net - x[1].net);

    // 가격대
    const bands: [string, (p: number) => boolean][] = [
      ["~99", (p) => p < 100],
      ["100~199", (p) => p >= 100 && p < 200],
      ["200~299", (p) => p >= 200 && p < 300],
      ["300+", (p) => p >= 300],
    ];
    const bandAgg = bands.map(([label, test]) => {
      let q = 0,
        n = 0;
      byProd.forEach((a, pid) => {
        const price = pMap.get(pid)?.price ?? 0;
        if (test(price)) {
          q += a.qty;
          n += a.net;
        }
      });
      return { label, q, n };
    });

    // 재고 등급 + 품절임박 + 데드스톡
    let gA = 0, gB = 0, gC = 0;
    const dead: { p: Prod; stock: number; tied: number }[] = [];
    const reorder: { p: Prod; stock: number; perDay: number; daysLeft: number; suggest: number }[] = [];
    prods.forEach((p) => {
      const stock = stockMap.get(p.id)?.total ?? 0;
      if (stock <= 0) return;
      const velQty = byProd.get(p.id)?.velQty ?? 0;
      const perDay = Math.max(velQty, 0) / VELOCITY_DAYS;
      if (velQty <= 0) {
        dead.push({ p, stock, tied: stock * (costs.get(p.id) ?? 0) });
        return;
      }
      const daysLeft = stock / perDay;
      if (daysLeft <= 30) gA++;
      else if (daysLeft <= 60) gB++;
      else gC++;
      if (daysLeft <= 7)
        reorder.push({
          p,
          stock,
          perDay,
          daysLeft,
          suggest: Math.max(Math.ceil(perDay * 14) - stock, 1),
        });
    });
    dead.sort((a, b) => b.tied - a.tied);
    reorder.sort((a, b) => a.daysLeft - b.daysLeft);
    const deadTied = dead.reduce((a, d) => a + d.tied, 0);

    // 상위 고객
    const topCust = [...byCust.entries()]
      .sort((x, y) => y[1].net - x[1].net)
      .slice(0, 20);

    return { totalNet, totalQty, best, cats, bandAgg, gA, gB, gC, dead, deadTied, reorder, topCust };
  }, [movs, days, bestBy, pMap, stockMap, prods, costs, recCust]);

  if (role === "staff")
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-neutral-500">
          분석은 오너/관리자 전용 화면입니다.
        </main>
      </div>
    );

  const bars = (rows: [string, number][], unit: string) => {
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return (
      <div className="space-y-1.5">
        {rows.map(([labelText, v]) => (
          <div key={labelText} className="grid grid-cols-[110px_1fr_90px] items-center gap-2">
            <div className="text-xs text-neutral-500 text-right truncate" title={labelText}>{labelText}</div>
            <div className="h-4"><div className="h-4 bg-blue-600 dark:bg-blue-500 rounded-r" style={{ width: `${Math.max((v / max) * 100, 1)}%` }} /></div>
            <div className="text-xs text-neutral-500 tabular-nums">{fmt(Math.round(v))}{unit}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white">
          분석 <span className="text-xs font-normal text-amber-500 align-middle border border-amber-300 dark:border-amber-700 rounded-full px-2 py-0.5">beta</span>
        </h1>
        <p className="text-sm text-neutral-500 mt-1 mb-4">
          판매·재고·고객 데이터에서 다음 행동을 뽑아냅니다. 판매 지표 기간:
        </p>
        <div className="flex gap-2 mb-5">
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-sm ${days === d ? "bg-blue-600 text-white font-semibold" : "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"}`}>
              최근 {d}일
            </button>
          ))}
        </div>

        {!analysis ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <div className="space-y-6">
            {/* ===== M1 판매 ===== */}
            <section>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white mb-3">📈 판매 분석</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className={card}><div className="text-xs text-neutral-500">기간 순매출</div><div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">AED {fmt(Math.round(analysis.totalNet))}</div></div>
                <div className={card}><div className="text-xs text-neutral-500">판매 수량 (반품 차감)</div><div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">{fmt(analysis.totalQty)}개</div></div>
              </div>

              <div className={card}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                    베스트셀러 TOP 20
                    <Help text="선택 기간의 판매 순위입니다. '남은 재고'와 '소진 예상'을 함께 보면 재주문 판단이 됩니다." />
                  </h3>
                  <div className="ml-auto flex gap-1">
                    {(["net", "qty"] as const).map((k) => (
                      <button key={k} onClick={() => setBestBy(k)}
                        className={`px-3 py-1 rounded-full text-xs ${bestBy === k ? "bg-neutral-900 dark:bg-white text-white dark:text-black" : "border border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>
                        {k === "net" ? "매출순" : "수량순"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-neutral-50 dark:bg-neutral-800">
                      <th className={thCls + " text-left"}>#</th>
                      <th className={thCls + " text-left"}>상품</th>
                      <th className={thCls + " text-right"}>판매</th>
                      <th className={thCls + " text-right"}>순매출</th>
                      <th className={thCls + " text-right"}>MCC</th>
                      <th className={thCls + " text-right"}>MOE</th>
                      <th className={thCls + " text-right"}>남은 재고</th>
                    </tr></thead>
                    <tbody>
                      {analysis.best.map(([pid, a], i) => {
                        const p = pMap.get(pid);
                        const stock = stockMap.get(pid)?.total ?? 0;
                        return (
                          <tr key={pid} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className={tdCls + " text-neutral-400"}>{i + 1}</td>
                            <td className={tdCls}>
                              <span className="flex items-center gap-2">
                                <Thumb url={p?.image_url ?? null} />
                                <span>
                                  <span className="block leading-tight text-neutral-900 dark:text-white">{p?.name ?? "?"}</span>
                                  <span className="text-[11px] text-neutral-400">{p?.category}</span>
                                </span>
                              </span>
                            </td>
                            <td className={tdCls + " text-right"}>{fmt(a.qty)}개</td>
                            <td className={tdCls + " text-right font-semibold"}>{fmt(Math.round(a.net))}</td>
                            <td className={tdCls + " text-right text-neutral-500"}>{fmt(a.mcc)}</td>
                            <td className={tdCls + " text-right text-neutral-500"}>{fmt(a.moe)}</td>
                            <td className={tdCls + ` text-right ${stock <= 2 ? "text-red-600 font-bold" : ""}`}>{fmt(stock)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className={card}>
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">카테고리별 순매출<Help text="선택 기간 동안 어떤 카테고리가 돈을 벌었는지입니다. 사입·자체브랜드 후보 판단의 기초." /></h3>
                  {bars(analysis.cats.map(([c, e]) => [c, e.net] as [string, number]), "")}
                </div>
                <div className={card}>
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">가격대별 판매<Help text="어느 가격대가 잘 팔리는지입니다. 다음 사입 때 가격대 구성 가이드로 쓰세요." /></h3>
                  {bars(analysis.bandAgg.map((b) => [b.label + " (" + fmt(b.q) + "개)", b.n] as [string, number]), "")}
                </div>
              </div>
            </section>

            {/* ===== M2 재고 ===== */}
            <section>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white mb-3">📦 재고 분석 <span className="text-xs font-normal text-neutral-400">(판매속도 기준: 최근 {VELOCITY_DAYS}일)</span></h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  ["🟢 A등급 (30일 내 소진)", analysis.gA, "재고가 빠르게 도는 상품 — 품절 주의 대상이기도 합니다"],
                  ["🟡 B등급 (31~60일)", analysis.gB, "정상 회전"],
                  ["🟠 C등급 (60일+)", analysis.gC, "회전 느림 — 재주문 보류 후보"],
                  ["🔴 데드스톡 (21일 판매 0)", analysis.dead.length, "최근 3주간 하나도 안 팔린 재고 보유 상품"],
                ].map(([labelText, v, help]) => (
                  <div key={labelText as string} className={card}>
                    <div className="text-xs text-neutral-500">{labelText as string}<Help text={help as string} /></div>
                    <div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">{fmt(v as number)}개</div>
                  </div>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className={card}>
                  <h3 className="text-sm font-semibold text-red-600 mb-1">⏰ 품절 임박 — 재주문 후보 {fmt(analysis.reorder.length)}개
                    <Help text="현재 판매 속도라면 7일 안에 품절되는 상품입니다. 추천 수량 = 2주치 판매량 - 현재 재고." /></h3>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-neutral-50 dark:bg-neutral-800">
                        <th className={thCls + " text-left"}>상품</th>
                        <th className={thCls + " text-right"}>재고</th>
                        <th className={thCls + " text-right"}>소진</th>
                        <th className={thCls + " text-right"}>추천</th>
                      </tr></thead>
                      <tbody>
                        {analysis.reorder.slice(0, 30).map((r) => (
                          <tr key={r.p.id} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className={tdCls}><span className="flex items-center gap-2"><Thumb url={r.p.image_url} /><span className="truncate max-w-40">{r.p.name}</span></span></td>
                            <td className={tdCls + " text-right"}>{fmt(r.stock)}</td>
                            <td className={tdCls + " text-right text-red-600 font-semibold"}>{Math.ceil(r.daysLeft)}일</td>
                            <td className={tdCls + " text-right"}><span className="rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5">+{fmt(r.suggest)}개</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={card}>
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">🧊 데드스톡 — 묶인 원가 AED {fmt(Math.round(analysis.deadTied))}
                    <Help text="최근 3주간 판매 0인데 재고를 갖고 있는 상품입니다. 할인 처분·매장 이동·진열 변경 후보. 금액은 원가 기준으로 잠긴 돈." /></h3>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-neutral-50 dark:bg-neutral-800">
                        <th className={thCls + " text-left"}>상품</th>
                        <th className={thCls + " text-right"}>재고</th>
                        <th className={thCls + " text-right"}>묶인 원가</th>
                      </tr></thead>
                      <tbody>
                        {analysis.dead.slice(0, 30).map((d) => (
                          <tr key={d.p.id} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className={tdCls}><span className="flex items-center gap-2"><Thumb url={d.p.image_url} /><span className="truncate max-w-40">{d.p.name}</span></span></td>
                            <td className={tdCls + " text-right"}>{fmt(d.stock)}</td>
                            <td className={tdCls + " text-right font-semibold"}>{fmt(Math.round(d.tied))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* ===== M3 고객 ===== */}
            {analysis.topCust.length > 0 && (
              <section>
                <h2 className="text-base font-bold text-neutral-900 dark:text-white mb-3">👥 상위 고객 <span className="text-xs font-normal text-neutral-400">(영수증에 고객이 기록된 경우)</span></h2>
                <div className={card}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-neutral-50 dark:bg-neutral-800">
                        <th className={thCls + " text-left"}>#</th>
                        <th className={thCls + " text-left"}>고객</th>
                        <th className={thCls + " text-right"}>구매액</th>
                        <th className={thCls + " text-right"}>영수증</th>
                        <th className={thCls + " text-right"}>마지막 방문</th>
                      </tr></thead>
                      <tbody>
                        {analysis.topCust.map(([name, e], i) => (
                          <tr key={name} className="border-t border-neutral-100 dark:border-neutral-800">
                            <td className={tdCls + " text-neutral-400"}>{i + 1}</td>
                            <td className={tdCls + " text-neutral-900 dark:text-white"}>{name}</td>
                            <td className={tdCls + " text-right font-semibold"}>AED {fmt(Math.round(e.net))}</td>
                            <td className={tdCls + " text-right"}>{fmt(e.recs.size)}건</td>
                            <td className={tdCls + " text-right text-neutral-500"}>{new Date(e.last).toLocaleDateString("ko-KR", { timeZone: "Asia/Dubai", month: "numeric", day: "numeric" })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-neutral-400">고객 데이터는 오너/관리자만 볼 수 있습니다. 마케팅 활용은 동의 범위 확정 후.</p>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
