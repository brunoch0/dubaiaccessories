"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  flag: string | null;
  price: number | null;
  barcode: string | null;
  mcc: number;
  moe: number;
  wh: number;
  total: number;
  cost: number | null;
  margin: number | null;
};

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const PER = 100;

function InventoryInner() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [hasCost, setHasCost] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [store, setStore] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [sort, setSort] = useState<{ k: keyof Product; d: 1 | -1 }>({ k: "sku", d: 1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Product | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [pData, iData, cData] = await Promise.all([
        fetchAll<{
          id: string;
          sku: string;
          name: string;
          category: string;
          flag: string | null;
          price: number | null;
          barcode: string | null;
        }>(supabase, "products", "id,sku,name,category,flag,price,barcode"),
        fetchAll<{ product_id: string; store: string; qty: number }>(
          supabase,
          "inventory",
          "product_id,store,qty"
        ),
        fetchAll<{ product_id: string; cost: number | null }>(
          supabase,
          "product_costs",
          "product_id,cost"
        ),
      ]);
      const pRes = { data: pData };
      const iRes = { data: iData };
      const cRes = { data: cData };
      const inv = new Map<string, { mcc: number; moe: number; wh: number }>();
      (iRes.data ?? []).forEach((r) => {
        const e = inv.get(r.product_id) ?? { mcc: 0, moe: 0, wh: 0 };
        if (r.store === "MCC") e.mcc = r.qty;
        else if (r.store === "MOE") e.moe = r.qty;
        else e.wh = r.qty;
        inv.set(r.product_id, e);
      });
      const costs = new Map((cRes.data ?? []).map((c) => [c.product_id, c.cost]));
      const withCost = (cRes.data ?? []).length > 0;
      setHasCost(withCost);
      setRows(
        (pRes.data ?? []).map((p) => {
          const e = inv.get(p.id) ?? { mcc: 0, moe: 0, wh: 0 };
          const cost = withCost ? (costs.get(p.id) ?? null) : null;
          const margin =
            p.price && cost ? Math.round(((p.price - cost) / p.price) * 100) : null;
          return {
            ...p,
            ...e,
            total: e.mcc + e.moe + e.wh,
            cost,
            margin,
          } as Product;
        })
      );
    })();
  }, []);

  const cats = useMemo(
    () => (rows ? [...new Set(rows.map((r) => r.category))].sort() : []),
    [rows]
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    const qq = q.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          (!qq ||
            r.name.toLowerCase().includes(qq) ||
            r.sku.includes(qq) ||
            (r.barcode ?? "").includes(qq)) &&
          (!cat || r.category === cat) &&
          (!store ||
            (store === "mcc" ? r.mcc > 0 : store === "moe" ? r.moe > 0 : r.wh > 0)) &&
          (!status ||
            (status === "pos"
              ? r.total > 0
              : status === "zero"
              ? r.total === 0
              : r.mcc < 0 || r.moe < 0 || r.wh < 0))
      )
      .sort((a, b) => {
        const x = a[sort.k],
          y = b[sort.k];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (
          (typeof x === "string"
            ? x.localeCompare(y as string)
            : (x as number) - (y as number)) * sort.d
        );
      });
  }, [rows, q, cat, store, status, sort]);

  const pageRows = filtered.slice(page * PER, (page + 1) * PER);

  const cols: [keyof Product, string, boolean][] = [
    ["sku", "SKU", false],
    ["name", "상품명", false],
    ["category", "카테고리", false],
    ["price", "판매가", true],
    ...(hasCost
      ? ([
          ["cost", "원가", true],
          ["margin", "마진%", true],
        ] as [keyof Product, string, boolean][])
      : []),
    ["mcc", "MCC", true],
    ["moe", "MOE", true],
    ["total", "합계", true],
  ];

  const th = (k: keyof Product, label: string, right: boolean) => (
    <th
      key={k}
      onClick={() => {
        setSort((s) => (s.k === k ? { k, d: s.d === 1 ? -1 : 1 } : { k, d: 1 }));
        setPage(0);
      }}
      className={`px-3 py-2 text-xs font-semibold text-neutral-500 cursor-pointer select-none whitespace-nowrap sticky top-0 bg-neutral-100 dark:bg-neutral-900 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {label} {sort.k === k ? (sort.d === 1 ? "▲" : "▼") : ""}
    </th>
  );

  const qtyCls = (n: number) =>
    n < 0 ? "text-red-600 font-bold" : n === 0 ? "text-neutral-400" : "";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            placeholder="검색: 상품명 / SKU / 바코드"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            className="flex-1 min-w-44 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500"
          />
          <select
            value={cat}
            onChange={(e) => {
              setCat(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm text-neutral-900 dark:text-white"
          >
            <option value="">카테고리 전체</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            value={store}
            onChange={(e) => {
              setStore(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm text-neutral-900 dark:text-white"
          >
            <option value="">매장 전체</option>
            <option value="mcc">MCC 보유</option>
            <option value="moe">MOE 보유</option>
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm text-neutral-900 dark:text-white"
          >
            <option value="">상태 전체</option>
            <option value="pos">재고 있음</option>
            <option value="zero">품절(0)</option>
            <option value="neg">마이너스</option>
          </select>
        </div>

        {!rows ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm bg-white dark:bg-neutral-950">
                <thead>
                  <tr>{cols.map(([k, l, r]) => th(k, l, r))}</tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSel(r)}
                      className="border-t border-neutral-100 dark:border-neutral-900 hover:bg-blue-50/60 dark:hover:bg-blue-950/30 cursor-pointer"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                        {r.sku}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-900 dark:text-white">
                        {r.name}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                        {r.category}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(r.price)}
                      </td>
                      {hasCost && (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmt(r.cost)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.margin === null ? "—" : r.margin + "%"}
                          </td>
                        </>
                      )}
                      <td className={`px-3 py-2 text-right tabular-nums ${qtyCls(r.mcc)}`}>
                        {r.mcc}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${qtyCls(r.moe)}`}>
                        {r.moe}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${qtyCls(
                          r.total
                        )}`}
                      >
                        {r.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3 text-sm text-neutral-500">
              <span>
                {fmt(filtered.length)}개 중{" "}
                {filtered.length ? page * PER + 1 : 0}–
                {Math.min((page + 1) * PER, filtered.length)}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 disabled:opacity-30"
                >
                  이전
                </button>
                <button
                  disabled={(page + 1) * PER >= filtered.length}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 disabled:opacity-30"
                >
                  다음
                </button>
              </div>
            </div>
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
            className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl p-6"
          >
            <h3 className="font-bold text-neutral-900 dark:text-white">{sel.name}</h3>
            <p className="text-xs text-neutral-500 mb-4">
              {sel.category} · SKU {sel.sku} · 바코드 {sel.barcode || "—"}
              {sel.flag ? ` · ${sel.flag}` : ""}
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ["판매가", fmt(sel.price)],
                  ...(hasCost
                    ? ([
                        ["원가", fmt(sel.cost)],
                        ["마진율", sel.margin === null ? "—" : sel.margin + "%"],
                      ] as [string, string][])
                    : []),
                  ["재고 합계", String(sel.total)],
                  ["MCC", String(sel.mcc)],
                  ["MOE", String(sel.moe)],
                  ["창고", String(sel.wh)],
                ] as [string, string][]
              ).map(([l, v]) => (
                <div
                  key={l}
                  className="bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2"
                >
                  <div className="text-[11px] text-neutral-500">{l}</div>
                  <div className="font-semibold text-neutral-900 dark:text-white">
                    {v}
                  </div>
                </div>
              ))}
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

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryInner />
    </Suspense>
  );
}
