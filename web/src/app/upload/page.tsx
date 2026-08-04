"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type CsvRow = Record<string, string>;
type NewProduct = {
  sku: string;
  name: string;
  category: string;
  price: number | null;
  cost: number | null;
  barcode: string;
  stocks: { store: string; qty: number }[];
};
type StockChange = {
  productId: string;
  sku: string;
  name: string;
  store: string;
  before: number;
  after: number;
};
type PriceChange = { productId: string; sku: string; before: number | null; after: number | null };

type Diff = {
  newProducts: NewProduct[];
  stockChanges: StockChange[];
  priceChanges: PriceChange[];
  csvRows: number;
};

const STORES: { col: string; store: string }[] = [
  { col: "In stock [MCC]", store: "MCC" },
  { col: "In stock [MOE]", store: "MOE" },
  { col: "In stock [WareHouse]", store: "WH" },
];

function num(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "" || t === "variable") return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/loyverse-sync", { method: "POST" });
      const j = await res.json();
      setResult(
        j.ok
          ? `✅ 영수증 ${j.receipts}건 → 판매 ${j.lines}건 반영 (미매칭 SKU ${j.unknownSku})`
          : `⚠️ ${j.error}`
      );
    } catch (e) {
      setResult("⚠️ " + (e instanceof Error ? e.message : String(e)));
    }
    setBusy(false);
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-black text-sm font-semibold px-4 py-2.5 disabled:opacity-40"
      >
        {busy ? "동기화 중…" : "지금 동기화"}
      </button>
      {result && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{result}</p>
      )}
    </div>
  );
}

export default function UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "ready" | "applying" | "done">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string[]>([]);

  async function analyze(file: File) {
    setPhase("analyzing");
    setError(null);
    setDiff(null);
    setFileName(file.name);

    const text = await file.text();
    const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data.filter((r) => (r["SKU"] ?? "").trim());
    if (rows.length === 0 || !("SKU" in (rows[0] ?? {}))) {
      setError(
        "Loyverse 상품 CSV 형식이 아닙니다. 백오피스 → Items → Export 파일을 올려주세요."
      );
      setPhase("idle");
      return;
    }

    const supabase = createClient();
    const [products, inventory] = await Promise.all([
      fetchAll<{ id: string; sku: string; price: number | null }>(
        supabase,
        "products",
        "id,sku,price"
      ),
      fetchAll<{ product_id: string; store: string; qty: number }>(
        supabase,
        "inventory",
        "product_id,store,qty"
      ),
    ]);
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const invMap = new Map<string, number>();
    inventory.forEach((r) => invMap.set(r.product_id + "|" + r.store, r.qty));

    const d: Diff = { newProducts: [], stockChanges: [], priceChanges: [], csvRows: rows.length };

    rows.forEach((r) => {
      const sku = r["SKU"].trim();
      const name = (r["Name"] ?? "").trim();
      const price =
        num(r["Price [MCC]"]) ?? num(r["Price [MOE]"]) ?? num(r["Default price"]);
      const existing = bySku.get(sku);

      if (!existing) {
        d.newProducts.push({
          sku,
          name,
          category: (r["Category"] ?? "").trim() || "99 미분류",
          price,
          cost: num(r["Cost"]),
          barcode: (r["Barcode"] ?? "").trim(),
          stocks: STORES.map(({ col, store }) => ({
            store,
            qty: Math.trunc(num(r[col]) ?? 0),
          })).filter((s) => s.qty !== 0),
        });
        return;
      }

      STORES.forEach(({ col, store }) => {
        const after = Math.trunc(num(r[col]) ?? 0);
        const before = invMap.get(existing.id + "|" + store) ?? 0;
        if (after !== before) {
          d.stockChanges.push({
            productId: existing.id,
            sku,
            name,
            store,
            before,
            after,
          });
        }
      });

      if (price !== null && price !== existing.price) {
        d.priceChanges.push({ productId: existing.id, sku, before: existing.price, after: price });
      }
    });

    setDiff(d);
    setPhase("ready");
  }

  async function apply() {
    if (!diff) return;
    setPhase("applying");
    const supabase = createClient();
    const log: string[] = [];

    try {
      // 1) 신규 상품
      if (diff.newProducts.length > 0) {
        for (let i = 0; i < diff.newProducts.length; i += 300) {
          const chunk = diff.newProducts.slice(i, i + 300);
          const { data, error } = await supabase
            .from("products")
            .insert(
              chunk.map((p) => ({
                sku: p.sku,
                name: p.name,
                category: p.category,
                price: p.price,
                barcode: p.barcode,
                flag: "CSV 신규",
              }))
            )
            .select("id,sku");
          if (error) throw new Error("신규 상품 등록 실패: " + error.message);
          const idMap = new Map((data ?? []).map((r) => [r.sku, r.id]));
          const costs = chunk
            .filter((p) => idMap.has(p.sku))
            .map((p) => ({ product_id: idMap.get(p.sku)!, cost: p.cost }));
          if (costs.length) await supabase.from("product_costs").upsert(costs);
          const invRows = chunk.flatMap((p) =>
            p.stocks.map((s) => ({
              product_id: idMap.get(p.sku)!,
              store: s.store,
              qty: s.qty,
            }))
          );
          if (invRows.length)
            await supabase.from("inventory").upsert(invRows, {
              onConflict: "product_id,store",
            });
        }
        log.push(`신규 상품 ${fmt(diff.newProducts.length)}개 등록`);
      }

      // 2) 재고 변경 (CSV = 기준값으로 세팅)
      if (diff.stockChanges.length > 0) {
        for (let i = 0; i < diff.stockChanges.length; i += 500) {
          const chunk = diff.stockChanges.slice(i, i + 500);
          const { error } = await supabase.from("inventory").upsert(
            chunk.map((c) => ({
              product_id: c.productId,
              store: c.store,
              qty: c.after,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "product_id,store" }
          );
          if (error) throw new Error("재고 반영 실패: " + error.message);
        }
        log.push(`재고 수량 ${fmt(diff.stockChanges.length)}건 갱신`);
      }

      // 3) 가격 변경
      if (diff.priceChanges.length > 0) {
        for (let i = 0; i < diff.priceChanges.length; i += 50) {
          await Promise.all(
            diff.priceChanges
              .slice(i, i + 50)
              .map((c) =>
                supabase.from("products").update({ price: c.after }).eq("id", c.productId)
              )
          );
        }
        log.push(`판매가 ${fmt(diff.priceChanges.length)}건 갱신`);
      }

      if (log.length === 0) log.push("변경 사항 없음 — 이미 최신 상태입니다.");

      // 활동 기록 남기기
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.from("activity_log").insert({
        type: "csv_upload",
        summary: `CSV 업로드: ${fileName ?? "파일"}`,
        detail: {
          신규: diff.newProducts.length,
          재고변경: diff.stockChanges.length,
          가격변경: diff.priceChanges.length,
        },
        created_by: user?.id ?? null,
      });

      setReport(log);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white">
          재고 CSV 업로드
        </h1>
        <p className="text-sm text-neutral-500 mt-1 mb-5">
          Loyverse 백오피스 → Items → Export 로 내려받은 CSV를 올리면, 시스템 재고를 그
          기준으로 맞춥니다. (적용 전에 변경 내용을 먼저 보여드립니다)
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) analyze(f);
          }}
          className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl p-10 text-center cursor-pointer bg-white dark:bg-neutral-900 hover:border-blue-500"
        >
          <p className="text-3xl mb-2">📄</p>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {fileName ?? "CSV 파일을 끌어다 놓거나 클릭해서 선택"}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyze(f);
            }}
          />
        </div>

        {phase === "analyzing" && (
          <p className="mt-4 text-sm text-neutral-500">분석 중…</p>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {diff && phase !== "done" && (
          <div className="mt-5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
              변경 미리보기 <span className="text-neutral-400 font-normal">(CSV {fmt(diff.csvRows)}행)</span>
            </h2>
            <ul className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1 mb-4">
              <li>🆕 신규 상품: <b>{fmt(diff.newProducts.length)}개</b></li>
              <li>📦 재고 수량 변경: <b>{fmt(diff.stockChanges.length)}건</b></li>
              <li>💰 판매가 변경: <b>{fmt(diff.priceChanges.length)}건</b></li>
            </ul>
            {diff.stockChanges.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800 mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                      <th className="px-2 py-1.5 text-left">SKU</th>
                      <th className="px-2 py-1.5 text-left">상품</th>
                      <th className="px-2 py-1.5">매장</th>
                      <th className="px-2 py-1.5 text-right">변경</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.stockChanges.slice(0, 100).map((c, i) => (
                      <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                        <td className="px-2 py-1 text-neutral-500">{c.sku}</td>
                        <td className="px-2 py-1">{c.name}</td>
                        <td className="px-2 py-1 text-center">{c.store}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {c.before} → <b>{c.after}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              onClick={apply}
              disabled={phase === "applying"}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-3"
            >
              {phase === "applying" ? "적용 중…" : "이대로 적용하기"}
            </button>
          </div>
        )}

        <div className="mt-8 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
            ⚡ Loyverse API 동기화
          </h2>
          <p className="text-xs text-neutral-500 mb-3">
            토큰 연결 후 사용. 판매 영수증을 자동으로 가져와 재고에 반영합니다.
            성공하면 시스템이 API 모드로 전환되어 스캔의 수동 판매 입력이 숨겨집니다.
          </p>
          <SyncButton />
        </div>

        {phase === "done" && (
          <div className="mt-5 bg-white dark:bg-neutral-900 border border-green-300 dark:border-green-900 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">
              ✅ 적용 완료
            </h2>
            <ul className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1">
              {report.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
