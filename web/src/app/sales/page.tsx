"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Mov = {
  id: number;
  product_id: string;
  store: string;
  type: "sale" | "return";
  qty: number;
  reason: string | null;
  created_at: string;
};
type Prod = { id: string; sku: string; name: string; price: number | null };

type Receipt = {
  no: string;
  at: string;
  store: string;
  lines: { name: string; sku: string; qty: number; price: number | null; signed: number }[];
  total: number;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const DUBAI = "Asia/Dubai";
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: DUBAI });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: DUBAI,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toLocaleDateString("en-CA", { timeZone: DUBAI });
}

export default function SalesPage() {
  const [role, setRole] = useState<string | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [prods, setProds] = useState<Map<string, Prod>>(new Map());
  const [sel, setSel] = useState<Receipt | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setRole(data?.role ?? "staff");
    });
    fetchAll<Prod>(supabase, "products", "id,sku,name,price").then((p) =>
      setProds(new Map(p.map((x) => [x.id, x])))
    );
  }, []);

  const load = useCallback(async () => {
    setMovs(null);
    const supabase = createClient();
    // 두바이 기준 날짜 범위 → UTC (두바이 = UTC+4)
    const fromIso = new Date(`${from}T00:00:00+04:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59+04:00`).toISOString();
    const all: Mov[] = [];
    for (let p = 0; ; p += 1000) {
      const { data, error } = await supabase
        .from("movements")
        .select("id,product_id,store,type,qty,reason,created_at")
        .in("type", ["sale", "return"])
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .range(p, p + 999);
      if (error || !data) break;
      all.push(...(data as Mov[]));
      if (data.length < 1000) break;
    }
    setMovs(all);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (role === "staff")
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-neutral-500">
          정산은 오너/관리자 전용 화면입니다.
        </main>
      </div>
    );

  const value = (m: Mov) => {
    const price = prods.get(m.product_id)?.price ?? 0;
    return (m.type === "return" ? -1 : 1) * m.qty * price;
  };
  const qtySigned = (m: Mov) => (m.type === "return" ? -m.qty : m.qty);

  const rows = movs ?? [];
  const totalQty = rows.reduce((a, m) => a + qtySigned(m), 0);
  const totalVal = rows.reduce((a, m) => a + value(m), 0);

  // 일별 집계
  const byDay = new Map<
    string,
    { mccQ: number; moeQ: number; mccV: number; moeV: number }
  >();
  rows.forEach((m) => {
    const d = dayOf(m.created_at);
    const e = byDay.get(d) ?? { mccQ: 0, moeQ: 0, mccV: 0, moeV: 0 };
    if (m.store === "MCC") {
      e.mccQ += qtySigned(m);
      e.mccV += value(m);
    } else if (m.store === "MOE") {
      e.moeQ += qtySigned(m);
      e.moeV += value(m);
    }
    byDay.set(d, e);
  });
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  // 영수증 그룹 (Loyverse 동기화분)
  const recMap = new Map<string, Receipt>();
  let manualCount = 0;
  rows.forEach((m) => {
    if (!m.reason?.startsWith("Loyverse ")) {
      if (m.type === "sale") manualCount += m.qty;
      return;
    }
    const no = m.reason.replace("Loyverse ", "");
    const p = prods.get(m.product_id);
    const r =
      recMap.get(no) ??
      ({ no, at: m.created_at, store: m.store, lines: [], total: 0 } as Receipt);
    r.lines.push({
      name: p?.name ?? "?",
      sku: p?.sku ?? "",
      qty: m.qty,
      price: p?.price ?? null,
      signed: qtySigned(m),
    });
    r.total += value(m);
    if (m.created_at < r.at) r.at = m.created_at;
    recMap.set(no, r);
  });
  const receipts = [...recMap.values()].sort((a, b) => b.at.localeCompare(a.at));

  const preset = (label: string, f: string, t: string) => (
    <button
      key={label}
      onClick={() => {
        setFrom(f);
        setTo(t);
      }}
      className={`px-3 py-1.5 rounded-full text-sm ${
        from === f && to === t
          ? "bg-blue-600 text-white font-semibold"
          : "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
      }`}
    >
      {label}
    </button>
  );
  const today = isoDaysAgo(0);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white">정산</h1>
        <p className="text-sm text-neutral-500 mt-1 mb-4">
          수량 × 등록 판매가 기준 <b>추정</b> 정산입니다 (POS 할인 미반영). 카드기 정산과
          대조용으로 사용하세요.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {preset("오늘", today, today)}
          {preset("어제", isoDaysAgo(1), isoDaysAgo(1))}
          {preset("최근 7일", isoDaysAgo(6), today)}
          {preset("최근 30일", isoDaysAgo(29), today)}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-white"
          />
          <span className="text-neutral-400">~</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-white"
          />
        </div>

        {!movs ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["판매 수량 (반품 차감)", fmt(totalQty) + "개"],
                ["추정 매출 (정가)", "AED " + fmt(Math.round(totalVal))],
                ["POS 영수증", fmt(receipts.length) + "건"],
                ["수동 입력 판매", fmt(manualCount) + "개"],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"
                >
                  <div className="text-xs text-neutral-500">{l}</div>
                  <div className="text-2xl font-bold mt-1 text-neutral-900 dark:text-white">
                    {v}
                  </div>
                </div>
              ))}
            </div>

            <section className="mt-5">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2">
                일별 정산
              </h2>
              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-sm bg-white dark:bg-neutral-950">
                  <thead>
                    <tr className="bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500">
                      <th className="px-3 py-2 text-left">날짜</th>
                      <th className="px-3 py-2 text-right">MCC 수량</th>
                      <th className="px-3 py-2 text-right">MCC 금액</th>
                      <th className="px-3 py-2 text-right">MOE 수량</th>
                      <th className="px-3 py-2 text-right">MOE 금액</th>
                      <th className="px-3 py-2 text-right">합계 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                          이 기간에 판매 기록이 없습니다. (판매 동기화를 눌렀는지 확인)
                        </td>
                      </tr>
                    ) : (
                      days.map(([d, e]) => (
                        <tr
                          key={d}
                          className="border-t border-neutral-100 dark:border-neutral-900"
                        >
                          <td className="px-3 py-2">{d}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(e.mccQ)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmt(Math.round(e.mccV))}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(e.moeQ)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmt(Math.round(e.moeV))}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {fmt(Math.round(e.mccV + e.moeV))}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-5">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2">
                영수증 ({fmt(receipts.length)}건) — 행 클릭 = 상세
              </h2>
              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800 max-h-96 overflow-y-auto">
                <table className="w-full text-sm bg-white dark:bg-neutral-950">
                  <thead>
                    <tr className="bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500 sticky top-0">
                      <th className="px-3 py-2 text-left">영수증 번호</th>
                      <th className="px-3 py-2 text-left">시간</th>
                      <th className="px-3 py-2">매장</th>
                      <th className="px-3 py-2 text-right">품목</th>
                      <th className="px-3 py-2 text-right">추정 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr
                        key={r.no}
                        onClick={() => setSel(r)}
                        className="border-t border-neutral-100 dark:border-neutral-900 hover:bg-blue-50/60 dark:hover:bg-blue-950/30 cursor-pointer"
                      >
                        <td className="px-3 py-2 tabular-nums">{r.no}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                          {timeOf(r.at)}
                        </td>
                        <td className="px-3 py-2 text-center">{r.store}</td>
                        <td className="px-3 py-2 text-right">{r.lines.length}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-semibold ${
                            r.total < 0 ? "text-red-600" : ""
                          }`}
                        >
                          {fmt(Math.round(r.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      {sel && (
        <div
          onClick={() => setSel(null)}
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl p-6 max-h-[85vh] overflow-auto"
          >
            <h3 className="font-bold text-neutral-900 dark:text-white">
              영수증 {sel.no}
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              {timeOf(sel.at)} · {sel.store}
            </p>
            <div className="space-y-2">
              {sel.lines.map((l, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-neutral-900 dark:text-white">
                      {l.name}
                    </div>
                    <div className="text-[11px] text-neutral-400">SKU {l.sku}</div>
                  </div>
                  <div className="text-right whitespace-nowrap ml-3">
                    <div className={l.signed < 0 ? "text-red-600" : ""}>
                      {l.signed > 0 ? "" : "반품 "}
                      {l.qty}개
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {l.price !== null ? "AED " + fmt(l.price) : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-sm font-bold text-neutral-900 dark:text-white">
              <span>추정 합계 (정가 기준)</span>
              <span>AED {fmt(Math.round(sel.total))}</span>
            </div>
            <button
              onClick={() => setSel(null)}
              className="mt-4 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 py-2 text-sm text-neutral-700 dark:text-neutral-300"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
