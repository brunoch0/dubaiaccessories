"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

// ---- 재사용 테이블: 컬럼 드래그 순서변경(저장) + 헤더 클릭 정렬 + 검색 필터
type Col<T> = {
  key: string;
  label: string;
  right?: boolean;
  value?: (r: T) => string | number | null; // 정렬·검색·기본표시용
  render?: (r: T) => ReactNode;
};

function DataTable<T>({
  id,
  cols,
  rows,
  defaultSortKey,
  defaultDesc = false,
  onRowClick,
  rowKey,
  maxH,
  emptyText = "결과가 없습니다.",
}: {
  id: string;
  cols: Col<T>[];
  rows: T[];
  defaultSortKey?: string;
  defaultDesc?: boolean;
  onRowClick?: (r: T) => void;
  rowKey: (r: T) => string;
  maxH?: string;
  emptyText?: string;
}) {
  const storageKey = `wos-cols-${id}`;
  const [order, setOrder] = useState<string[]>(() => cols.map((c) => c.key));
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(
    defaultSortKey ? { k: defaultSortKey, d: defaultDesc ? -1 : 1 } : null
  );
  const [q, setQ] = useState("");
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        Array.isArray(s) &&
        s.length === cols.length &&
        cols.every((c) => s.includes(c.key))
      )
        setOrder(s);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const ocols = order
    .map((k) => cols.find((c) => c.key === k))
    .filter(Boolean) as Col<T>[];

  let out = rows;
  if (q.trim()) {
    const qq = q.toLowerCase();
    out = rows.filter((r) =>
      cols.some((c) => String(c.value?.(r) ?? "").toLowerCase().includes(qq))
    );
  }
  if (sort) {
    const c = cols.find((x) => x.key === sort.k);
    if (c?.value)
      out = [...out].sort((a, b) => {
        const x = c.value!(a),
          y = c.value!(b);
        if (x == null) return 1;
        if (y == null) return -1;
        return (
          (typeof x === "string"
            ? String(x).localeCompare(String(y))
            : (x as number) - (y as number)) * sort.d
        );
      });
  }

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔎 이 표에서 검색…"
        className="print:hidden mb-2 w-56 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs text-neutral-900 dark:text-white outline-none focus:border-blue-500"
      />
      <div
        className={`overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800 ${
          maxH ? "overflow-y-auto" : ""
        }`}
        style={maxH ? { maxHeight: maxH } : undefined}
      >
        <table className="w-full text-sm bg-white dark:bg-neutral-950">
          <thead>
            <tr className="bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500 sticky top-0 z-10">
              {ocols.map((c, i) => (
                <th
                  key={c.key}
                  draggable
                  onDragStart={() => (dragIdx.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx.current === null || dragIdx.current === i) return;
                    const next = [...order];
                    const [moved] = next.splice(dragIdx.current, 1);
                    next.splice(i, 0, moved);
                    setOrder(next);
                    localStorage.setItem(storageKey, JSON.stringify(next));
                    dragIdx.current = null;
                  }}
                  onClick={() =>
                    c.value &&
                    setSort((s) =>
                      s?.k === c.key ? { k: c.key, d: s.d === 1 ? -1 : 1 } : { k: c.key, d: 1 }
                    )
                  }
                  title="클릭=정렬 · 드래그=순서 변경"
                  className={`px-3 py-2 whitespace-nowrap select-none cursor-pointer ${
                    c.right ? "text-right" : "text-left"
                  }`}
                >
                  {c.label} {sort?.k === c.key ? (sort.d === 1 ? "▲" : "▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {out.length === 0 ? (
              <tr>
                <td colSpan={ocols.length} className="px-3 py-6 text-center text-neutral-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              out.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={() => onRowClick?.(r)}
                  className={`border-t border-neutral-100 dark:border-neutral-900 ${
                    onRowClick
                      ? "hover:bg-blue-50/60 dark:hover:bg-blue-950/30 cursor-pointer"
                      : ""
                  }`}
                >
                  {ocols.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-1.5 whitespace-nowrap tabular-nums ${
                        c.right ? "text-right" : "text-left"
                      }`}
                    >
                      {c.render ? c.render(r) : c.value?.(r) ?? ""}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Mov = {
  id: number;
  product_id: string;
  store: string;
  type: "sale" | "return";
  qty: number;
  reason: string | null;
  created_at: string;
  unit_price: number | null;
  line_total: number | null;
  discount: number | null;
  employee: string | null;
};
type Prod = { id: string; sku: string; name: string; price: number | null; image_url: string | null };

type Line = {
  name: string;
  sku: string;
  image: string | null;
  qty: number;
  gross: number; // 정가 합계
  net: number; // 실결제
  discount: number;
  isReturn: boolean;
  estimated: boolean;
};
type Receipt = {
  no: string;
  at: string;
  store: string;
  employee: string | null;
  customer: string | null;
  lines: Line[];
  gross: number;
  net: number;
  discount: number;
  estimated: boolean;
};

function dlCsv(name: string, rows: (string | number | null)[][]) {
  const csv =
    "﻿" +
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(",")
      )
      .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
}

const fmt = (n: number) => n.toLocaleString("en-US");
const DUBAI = "Asia/Dubai";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: DUBAI });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: DUBAI,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const isoDaysAgo = (d: number) =>
  new Date(Date.now() - d * 86400_000).toLocaleDateString("en-CA", { timeZone: DUBAI });

function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle print:hidden">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="ml-1 w-4 h-4 text-[10px] leading-4 text-center rounded-full border border-neutral-300 dark:border-neutral-600 text-neutral-400 hover:text-blue-600"
      >
        ?
      </button>
      {open && (
        <span
          onClick={() => setOpen(false)}
          className="absolute z-30 left-1/2 -translate-x-1/2 top-6 w-60 bg-neutral-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl font-normal cursor-pointer"
        >
          {text}
        </span>
      )}
    </span>
  );
}

const S_COLORS: Record<string, string> = { MCC: "#2a78d6", MOE: "#eb6834" };

export default function SalesPage() {
  const [role, setRole] = useState<string | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(13));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [storeF, setStoreF] = useState<"" | "MCC" | "MOE">("");
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [recCust, setRecCust] = useState<Map<string, string>>(new Map());
  const [prods, setProds] = useState<Map<string, Prod>>(new Map());
  const [sel, setSel] = useState<Receipt | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole(data?.role ?? "staff");
    });
    fetchAll<Prod>(supabase, "products", "id,sku,name,price,image_url").then((p) =>
      setProds(new Map(p.map((x) => [x.id, x])))
    );
    (async () => {
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

  const load = useCallback(async () => {
    setMovs(null);
    const supabase = createClient();
    const fromIso = new Date(`${from}T00:00:00+04:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59+04:00`).toISOString();
    const all: Mov[] = [];
    for (let p = 0; ; p += 1000) {
      const { data, error } = await supabase
        .from("movements")
        .select(
          "id,product_id,store,type,qty,reason,created_at,unit_price,line_total,discount,employee"
        )
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

  // ---- 금액 계산 (회계 기준: 실결제=Net, 정가=Gross, 할인=Gross-Net)
  const calc = (m: Mov) => {
    const p = prods.get(m.product_id);
    const grossUnit = m.unit_price ?? p?.price ?? 0;
    const gross = grossUnit * m.qty;
    const estimated = m.line_total === null;
    const net = m.line_total ?? gross;
    const sign = m.type === "return" ? -1 : 1;
    return {
      gross: sign * gross,
      net: sign * net,
      discount: m.discount ?? Math.max(gross - net, 0),
      estimated,
      sign,
    };
  };

  const rows = (movs ?? []).filter((m) => !storeF || m.store === storeF);
  let gross = 0,
    net = 0,
    discount = 0,
    qtyNet = 0,
    anyEstimated = false;
  rows.forEach((m) => {
    const c = calc(m);
    gross += c.gross;
    net += c.net;
    discount += c.discount;
    qtyNet += c.sign * m.qty;
    if (c.estimated) anyEstimated = true;
  });

  // ---- 일별 (매장 분리)
  const byDay = new Map<string, { MCC: number; MOE: number; qM: number; qO: number; disc: number }>();
  rows.forEach((m) => {
    const d = dayOf(m.created_at);
    const e = byDay.get(d) ?? { MCC: 0, MOE: 0, qM: 0, qO: 0, disc: 0 };
    const c = calc(m);
    if (m.store === "MCC") {
      e.MCC += c.net;
      e.qM += c.sign * m.qty;
    } else if (m.store === "MOE") {
      e.MOE += c.net;
      e.qO += c.sign * m.qty;
    }
    e.disc += c.discount;
    byDay.set(d, e);
  });
  const daysDesc = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const daysAsc = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // ---- 영수증
  const recMap = new Map<string, Receipt>();
  rows.forEach((m) => {
    if (!m.reason?.startsWith("Loyverse ")) return;
    const no = m.reason.replace("Loyverse ", "");
    const p = prods.get(m.product_id);
    const c = calc(m);
    const r =
      recMap.get(no) ??
      ({ no, at: m.created_at, store: m.store, employee: m.employee, customer: recCust.get(no) ?? null, lines: [], gross: 0, net: 0, discount: 0, estimated: false } as Receipt);
    if (!r.employee && m.employee) r.employee = m.employee;
    r.lines.push({
      name: p?.name ?? "?",
      sku: p?.sku ?? "",
      image: p?.image_url ?? null,
      qty: m.qty,
      gross: Math.abs(c.gross),
      net: Math.abs(c.net),
      discount: c.discount,
      isReturn: m.type === "return",
      estimated: c.estimated,
    });
    r.gross += c.gross;
    r.net += c.net;
    r.discount += c.discount;
    if (c.estimated) r.estimated = true;
    if (m.created_at < r.at) r.at = m.created_at;
    recMap.set(no, r);
  });
  const receipts = [...recMap.values()].sort((a, b) => b.at.localeCompare(a.at));
  const discountedReceipts = receipts.filter((r) => r.discount > 0.001);

  // ---- 인사이트
  const insights: string[] = [];
  if (daysAsc.length > 0) {
    const best = [...daysAsc].sort((a, b) => b[1].MCC + b[1].MOE - (a[1].MCC + a[1].MOE))[0];
    insights.push(
      `최고 매출일은 ${best[0]} (AED ${fmt(Math.round(best[1].MCC + best[1].MOE))}) 입니다.`
    );
    const mccSum = daysAsc.reduce((a, [, e]) => a + e.MCC, 0);
    const moeSum = daysAsc.reduce((a, [, e]) => a + e.MOE, 0);
    if (mccSum + moeSum > 0)
      insights.push(
        `매장 비중은 MCC ${Math.round((mccSum / (mccSum + moeSum)) * 100)}% : MOE ${Math.round(
          (moeSum / (mccSum + moeSum)) * 100
        )}% (순매출 기준).`
      );
    if (receipts.length > 0)
      insights.push(
        `영수증 평균 단가는 AED ${fmt(Math.round(net / receipts.length))}, 할인 적용 영수증은 ${
          discountedReceipts.length
        }건 (${Math.round((discountedReceipts.length / receipts.length) * 100)}%) — 할인 합계 AED ${fmt(
          Math.round(discount)
        )}.`
      );
  }

  // ---- 차트 스케일
  const chartMax = Math.max(...daysAsc.map(([, e]) => Math.max(e.MCC, e.MOE)), 1);
  const xEvery = Math.max(1, Math.ceil(daysAsc.length / 8));

  const preset = (labelText: string, f: string, t: string) => (
    <button
      key={labelText}
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
      {labelText}
    </button>
  );
  const today = isoDaysAgo(0);

  const kpi = (label: string, value: string, help: string, cls = "") => (
    <div key={label} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
      <div className="text-xs text-neutral-500">
        {label}
        <Help text={help} />
      </div>
      <div className={`text-xl md:text-2xl font-bold mt-1 text-neutral-900 dark:text-white ${cls}`}>{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 print:bg-white">
      <div className="print:hidden">
        <Nav />
      </div>

      <main className={`max-w-6xl mx-auto px-4 py-6 ${sel ? "print:hidden" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-white">정산</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {from} ~ {to} · {storeF || "전체 매장"} · 실결제(할인 반영) 기준
              {anyEstimated && " · 일부 항목은 정가 추정 포함"}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm text-neutral-700 dark:text-neutral-200 px-4 py-2 hover:border-blue-500"
          >
            🖨️ 출력
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 my-4 print:hidden">
          {preset("오늘", today, today)}
          {preset("어제", isoDaysAgo(1), isoDaysAgo(1))}
          {preset("최근 7일", isoDaysAgo(6), today)}
          {preset("최근 14일", isoDaysAgo(13), today)}
          {preset("최근 30일", isoDaysAgo(29), today)}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-white" />
          <span className="text-neutral-400">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-white" />
          <span className="mx-1 text-neutral-300">|</span>
          {(["", "MCC", "MOE"] as const).map((s) => (
            <button key={s || "all"} onClick={() => setStoreF(s)}
              className={`px-3 py-1.5 rounded-full text-sm ${
                storeF === s
                  ? "bg-neutral-900 dark:bg-white text-white dark:text-black font-semibold"
                  : "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
              }`}>
              {s || "전체 매장"}
            </button>
          ))}
        </div>

        {!movs ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {kpi("순매출 (실결제)", "AED " + fmt(Math.round(net)),
                "고객이 실제로 결제한 금액의 합계입니다 (할인 차감·반품 반영). 카드기 정산과 대조하는 기준 숫자예요.")}
              {kpi("정가 매출", "AED " + fmt(Math.round(gross)),
                "할인이 없었다면 발생했을 금액 (정가 × 수량). 순매출과의 차이가 할인 총액입니다.")}
              {kpi("할인 합계", "AED " + fmt(Math.round(discount)) + (gross > 0 ? ` (${Math.round((discount / gross) * 100)}%)` : ""),
                "정가 대비 깎아준 금액의 합계와 할인율입니다.", discount > 0 ? "!text-amber-600" : "")}
              {kpi("판매 수량 / 영수증", `${fmt(qtyNet)}개 / ${fmt(receipts.length)}건`,
                "반품을 차감한 순 판매 수량과 POS 영수증 수입니다.")}
            </div>

            {insights.length > 0 && (
              <div className="mt-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1.5">🔎 인사이트</h3>
                <ul className="space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
                  {insights.map((t) => (
                    <li key={t} className="flex gap-2"><span className="text-blue-500">▸</span><span>{t}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {daysAsc.length > 0 && (
              <section className="mt-5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5">
                <div className="flex items-center gap-4 mb-3">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">일별 순매출 추이</h2>
                  <span className="flex items-center gap-1 text-xs text-neutral-500">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: S_COLORS.MCC }} /> MCC
                  </span>
                  <span className="flex items-center gap-1 text-xs text-neutral-500">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: S_COLORS.MOE }} /> MOE
                  </span>
                </div>
                <div className="flex items-end gap-[3px] h-36 overflow-x-auto pb-1">
                  {daysAsc.map(([d, e], i) => (
                    <div key={d} className="flex flex-col items-center gap-1 min-w-7 flex-1 group relative">
                      <div className="flex items-end gap-[2px] w-full h-28 justify-center">
                        {(!storeF || storeF === "MCC") && (
                          <div title={`${d} MCC: AED ${fmt(Math.round(e.MCC))}`}
                            className="w-2.5 rounded-t-[3px]"
                            style={{ height: `${Math.max((e.MCC / chartMax) * 100, e.MCC > 0 ? 3 : 0)}%`, background: S_COLORS.MCC }} />
                        )}
                        {(!storeF || storeF === "MOE") && (
                          <div title={`${d} MOE: AED ${fmt(Math.round(e.MOE))}`}
                            className="w-2.5 rounded-t-[3px]"
                            style={{ height: `${Math.max((e.MOE / chartMax) * 100, e.MOE > 0 ? 3 : 0)}%`, background: S_COLORS.MOE }} />
                        )}
                      </div>
                      <span className={`text-[10px] text-neutral-400 whitespace-nowrap ${i % xEvery !== 0 ? "invisible" : ""}`}>
                        {d.slice(5)}
                      </span>
                      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-neutral-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                        {fmt(Math.round(e.MCC + e.MOE))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-5">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2 flex items-center gap-2">
                일별 정산
                <button
                  onClick={() =>
                    dlCsv(`정산_일별_${from}_${to}.csv`, [
                      ["날짜", "MCC 수량", "MCC 순매출", "MOE 수량", "MOE 순매출", "할인", "합계 순매출"],
                      ...daysDesc.map(([d, e]) => [
                        d, e.qM, Math.round(e.MCC), e.qO, Math.round(e.MOE),
                        Math.round(e.disc), Math.round(e.MCC + e.MOE),
                      ]),
                    ])
                  }
                  className="print:hidden text-xs rounded-md border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-neutral-500 hover:text-blue-600 hover:border-blue-500"
                >
                  ⬇ CSV
                </button>
              </h2>
              <DataTable
                id="daily"
                rows={daysDesc.map(([d, e]) => ({ d, ...e }))}
                rowKey={(r) => r.d}
                defaultSortKey="d"
                defaultDesc
                emptyText="이 기간에 판매 기록이 없습니다. (업로드 탭에서 ② 판매 동기화 실행)"
                cols={[
                  { key: "d", label: "날짜", value: (r) => r.d },
                  { key: "qM", label: "MCC 수량", right: true, value: (r) => r.qM, render: (r) => fmt(r.qM) },
                  { key: "MCC", label: "MCC 순매출", right: true, value: (r) => r.MCC, render: (r) => fmt(Math.round(r.MCC)) },
                  { key: "qO", label: "MOE 수량", right: true, value: (r) => r.qO, render: (r) => fmt(r.qO) },
                  { key: "MOE", label: "MOE 순매출", right: true, value: (r) => r.MOE, render: (r) => fmt(Math.round(r.MOE)) },
                  { key: "disc", label: "할인", right: true, value: (r) => r.disc, render: (r) => (r.disc > 0.001 ? <span className="text-amber-600">{fmt(Math.round(r.disc))}</span> : "—") },
                  { key: "total", label: "합계 순매출", right: true, value: (r) => r.MCC + r.MOE, render: (r) => <b>{fmt(Math.round(r.MCC + r.MOE))}</b> },
                ]}
              />
            </section>

            {(() => {
              const byEmp = new Map<string, { recs: Set<string>; qty: number; net: number; disc: number }>();
              rows.forEach((m) => {
                const key = m.employee ?? (m.reason?.startsWith("Loyverse ") ? "(미지정)" : "수동 입력");
                const e = byEmp.get(key) ?? { recs: new Set<string>(), qty: 0, net: 0, disc: 0 };
                const c = calc(m);
                if (m.reason?.startsWith("Loyverse ")) e.recs.add(m.reason);
                e.qty += c.sign * m.qty;
                e.net += c.net;
                e.disc += c.discount;
                byEmp.set(key, e);
              });
              const emps = [...byEmp.entries()].sort((a, b) => b[1].net - a[1].net);
              return emps.length === 0 ? null : (
                <section className="mt-5">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2">
                    직원별 정산
                    <Help text="영수증에 기록된 결제 담당 직원 기준입니다. 인센티브·목표 관리의 기초 데이터예요." />
                  </h2>
                  <DataTable
                    id="employees"
                    rows={emps.map(([name, e]) => ({ name, recs: e.recs.size, qty: e.qty, net: e.net, disc: e.disc }))}
                    rowKey={(r) => r.name}
                    defaultSortKey="net"
                    defaultDesc
                    cols={[
                      { key: "name", label: "직원", value: (r) => r.name },
                      { key: "recs", label: "영수증", right: true, value: (r) => r.recs, render: (r) => fmt(r.recs) },
                      { key: "qty", label: "판매 수량", right: true, value: (r) => r.qty, render: (r) => fmt(r.qty) },
                      { key: "disc", label: "할인", right: true, value: (r) => r.disc, render: (r) => (r.disc > 0.001 ? <span className="text-amber-600">{fmt(Math.round(r.disc))}</span> : "—") },
                      { key: "net", label: "순매출", right: true, value: (r) => r.net, render: (r) => <b>{fmt(Math.round(r.net))}</b> },
                    ]}
                  />
                </section>
              );
            })()}

            <section className="mt-5">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-2 flex items-center gap-2 flex-wrap">
                <span>
                  영수증 ({fmt(receipts.length)}건{discountedReceipts.length > 0 ? ` · 할인 ${discountedReceipts.length}건` : ""}) — 행 클릭 = 상세
                </span>
                <button
                  onClick={() =>
                    dlCsv(`영수증_내역_${from}_${to}.csv`, [
                      ["영수증번호", "일시", "매장", "직원", "고객", "품목수", "정가합계", "할인", "실결제"],
                      ...receipts.map((r) => [
                        r.no, timeOf(r.at), r.store, r.employee ?? "", r.customer ?? "", r.lines.length,
                        Math.round(r.gross), Math.round(r.discount), Math.round(r.net),
                      ]),
                    ])
                  }
                  className="print:hidden text-xs rounded-md border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-neutral-500 hover:text-blue-600 hover:border-blue-500"
                >
                  ⬇ 내역 CSV
                </button>
                <button
                  onClick={() =>
                    dlCsv(`영수증_상세_${from}_${to}.csv`, [
                      ["영수증번호", "일시", "매장", "직원", "고객", "SKU", "상품명", "구분", "수량", "정가합계", "할인", "실결제"],
                      ...receipts.flatMap((r) =>
                        r.lines.map((l) => [
                          r.no, timeOf(r.at), r.store, r.employee ?? "", r.customer ?? "", l.sku, l.name,
                          l.isReturn ? "반품" : "판매", l.qty,
                          Math.round(l.gross), Math.round(l.discount), Math.round(l.net),
                        ])
                      ),
                    ])
                  }
                  className="print:hidden text-xs rounded-md border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-neutral-500 hover:text-blue-600 hover:border-blue-500"
                >
                  ⬇ 상세 CSV
                </button>
              </h2>
              <DataTable
                id="receipts"
                rows={receipts}
                rowKey={(r) => r.no}
                defaultSortKey="at"
                defaultDesc
                onRowClick={(r) => setSel(r)}
                maxH="24rem"
                cols={[
                  {
                    key: "items", label: "상품",
                    render: (r) => (
                      <span className="flex items-center gap-1.5">
                        {r.lines.slice(0, 3).map((l, i) =>
                          l.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={l.image} alt="" loading="lazy" className="w-8 h-8 rounded-md object-cover bg-neutral-100 dark:bg-neutral-800" />
                          ) : (
                            <span key={i} className="w-8 h-8 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-300 text-xs flex items-center justify-center">✦</span>
                          )
                        )}
                        {r.lines.length > 3 && <span className="text-xs text-neutral-400">+{r.lines.length - 3}</span>}
                      </span>
                    ),
                    value: (r) => r.lines.map((l) => l.name + " " + l.sku).join(" "),
                  },
                  { key: "no", label: "영수증", value: (r) => r.no, render: (r) => <span className="text-neutral-500">{r.no}</span> },
                  { key: "at", label: "시간", value: (r) => r.at, render: (r) => <span className="text-neutral-500">{timeOf(r.at)}</span> },
                  { key: "store", label: "매장", value: (r) => r.store },
                  { key: "employee", label: "직원", value: (r) => r.employee ?? "", render: (r) => <span className="text-neutral-500">{r.employee ?? "—"}</span> },
                  { key: "customer", label: "고객", value: (r) => r.customer ?? "", render: (r) => <span className="text-neutral-500">{r.customer ?? "—"}</span> },
                  {
                    key: "discount", label: "할인", right: true, value: (r) => r.discount,
                    render: (r) =>
                      r.discount > 0.001 ? (
                        <span className="rounded-full bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 text-xs px-2 py-0.5">-{fmt(Math.round(r.discount))}</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      ),
                  },
                  {
                    key: "net", label: "실결제", right: true, value: (r) => r.net,
                    render: (r) => <b className={r.net < 0 ? "text-red-600" : ""}>{fmt(Math.round(r.net))}</b>,
                  },
                ]}
              />
            </section>
          </>
        )}
      </main>

      {sel && (
        <div onClick={() => setSel(null)}
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 print:static print:bg-white print:p-0 print:block">
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl p-6 max-h-[85vh] overflow-auto print:max-h-none print:shadow-none print:max-w-full print:dark:bg-white">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-neutral-900 dark:text-white">영수증 {sel.no}</h3>
                <p className="text-xs text-neutral-500 mb-4">
                  {timeOf(sel.at)} · {sel.store} 매장{sel.employee ? ` · 담당 ${sel.employee}` : ""}{sel.customer ? ` · 고객 ${sel.customer}` : ""} · Whisper of Spring
                </p>
              </div>
              <div className="flex gap-1.5 print:hidden">
                <button
                  onClick={() =>
                    dlCsv(`영수증_${sel.no}.csv`, [
                      ["영수증번호", "일시", "매장", "직원", "고객", "SKU", "상품명", "구분", "수량", "정가합계", "할인", "실결제"],
                      ...sel.lines.map((l) => [
                        sel.no, timeOf(sel.at), sel.store, sel.employee ?? "", sel.customer ?? "", l.sku, l.name,
                        l.isReturn ? "반품" : "판매", l.qty,
                        Math.round(l.gross), Math.round(l.discount), Math.round(l.net),
                      ]),
                    ])
                  }
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-300 px-3 py-1.5"
                >
                  ⬇ CSV
                </button>
                <button onClick={() => window.print()}
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-600 dark:text-neutral-300 px-3 py-1.5">
                  🖨️ 출력
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {sel.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-3 text-sm bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2 print:bg-white print:border print:border-neutral-200">
                  {l.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-neutral-100" />
                  ) : (
                    <span className="w-12 h-12 rounded-lg bg-neutral-100 dark:bg-neutral-700 text-neutral-300 flex items-center justify-center">✦</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-neutral-900 dark:text-white">{l.name}</div>
                    <div className="text-[11px] text-neutral-400">
                      SKU {l.sku} · {l.isReturn ? "반품 " : ""}{l.qty}개
                      {l.discount > 0.001 && (
                        <span className="text-amber-600"> · 할인 -{fmt(Math.round(l.discount))}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {l.discount > 0.001 && (
                      <div className="text-[11px] text-neutral-400 line-through">{fmt(Math.round(l.gross))}</div>
                    )}
                    <div className={`font-semibold ${l.isReturn ? "text-red-600" : "text-neutral-900 dark:text-white"}`}>
                      {l.isReturn ? "-" : ""}{fmt(Math.round(l.net))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-1 text-sm">
              <div className="flex justify-between text-neutral-500">
                <span>정가 합계<Help text="할인 전 금액 (정가 × 수량의 합)" /></span>
                <span className="tabular-nums">AED {fmt(Math.round(sel.gross))}</span>
              </div>
              {sel.discount > 0.001 && (
                <div className="flex justify-between text-amber-600">
                  <span>할인</span>
                  <span className="tabular-nums">- AED {fmt(Math.round(sel.discount))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-neutral-900 dark:text-white">
                <span>실결제 합계{sel.estimated && <span className="font-normal text-xs text-neutral-400"> (일부 추정)</span>}</span>
                <span className="tabular-nums">AED {fmt(Math.round(sel.net))}</span>
              </div>
            </div>
            <button onClick={() => setSel(null)}
              className="print:hidden mt-4 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 py-2 text-sm text-neutral-700 dark:text-neutral-300">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
