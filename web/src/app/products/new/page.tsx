"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";

type Cat = { id: string; name: string };

const card =
  "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5";
const input =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500";
const label = "block text-xs text-neutral-500 mb-1";

export default function NewProductPage() {
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [catId, setCatId] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState({ MCC: "", MOE: "", WH: "" });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ sku: string; barcode: string } | null>(null);

  useEffect(() => {
    fetch("/api/products/new")
      .then((r) => r.json())
      .then((j) => (j.ok ? setCats(j.categories) : setLoadErr(j.error)))
      .catch((e) => setLoadErr(String(e)));
  }, []);

  const catName = cats?.find((c) => c.id === catId)?.name ?? "";

  // 마진 미리보기
  const p = parseFloat(price),
    c = parseFloat(cost);
  const margin = p > 0 && c > 0 ? Math.round(((p - c) / p) * 100) : null;

  async function submit() {
    setErr(null);
    if (!name.trim() || !catId || !price) {
      setErr("이름 · 카테고리 · 가격은 필수입니다.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/products/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: desc,
          category_id: catId,
          category_name: catName,
          price: parseFloat(price),
          cost: cost ? parseFloat(cost) : null,
          qty: Object.fromEntries(
            Object.entries(qty).map(([k, v]) => [k, v ? parseInt(v, 10) : 0])
          ),
        }),
      });
      const j = await res.json();
      if (!j.ok) setErr(j.error);
      else setDone({ sku: j.sku, barcode: j.barcode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  function reset() {
    setName("");
    setDesc("");
    setPrice("");
    setCost("");
    setQty({ MCC: "", MOE: "", WH: "" });
    setDone(null);
    setErr(null);
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-neutral-900 dark:text-white">상품 등록</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            저장하면 Loyverse(POS)와 이 시스템에 동시에 등록됩니다. SKU와 바코드는 규칙대로
            자동 생성돼요.
          </p>
        </div>

        {done ? (
          <div className={card + " border-green-300 dark:border-green-900"}>
            <h2 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-3">
              ✅ 등록 완료 — POS에서도 바로 판매 가능합니다
            </h2>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2">
                <span className="text-[11px] text-neutral-500 block">SKU (자동 채번)</span>
                <b className="text-lg tracking-wide">{done.sku}</b>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2">
                <span className="text-[11px] text-neutral-500 block">
                  바코드 (라벨 인쇄용)
                </span>
                <b className="text-lg tracking-wide">{done.barcode}</b>
              </div>
            </div>
            <button
              onClick={reset}
              className="mt-4 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3"
            >
              ＋ 다음 상품 등록
            </button>
          </div>
        ) : (
          <>
            <div className={card + " space-y-4"}>
              <div>
                <span className={label}>이름 *</span>
                <input
                  className={input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: Anklet (자동 SKU가 뒤에 붙습니다)"
                />
              </div>
              <div>
                <span className={label}>카테고리 * (Loyverse와 동일 목록)</span>
                {loadErr ? (
                  <p className="text-sm text-red-600">{loadErr}</p>
                ) : (
                  <select
                    className={input}
                    value={catId}
                    onChange={(e) => setCatId(e.target.value)}
                  >
                    <option value="">선택…</option>
                    {(cats ?? []).map((cModel) => (
                      <option key={cModel.id} value={cModel.id}>
                        {cModel.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <span className={label}>설명 (선택 — 예: Silver925)</span>
                <input
                  className={input}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
            </div>

            <div className={card}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>판매가 (AED) *</span>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <div>
                  <span className={label}>원가 (AED)</span>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                  />
                </div>
              </div>
              {margin !== null && (
                <p className="mt-2 text-xs text-neutral-500">
                  마진율 <b className="text-blue-600">{margin}%</b>
                </p>
              )}
            </div>

            <div className={card}>
              <span className={label}>매장별 초기 재고 수량</span>
              <div className="grid grid-cols-3 gap-3 mt-1">
                {(["MCC", "MOE", "WH"] as const).map((s) => (
                  <div key={s}>
                    <span className="block text-[11px] text-neutral-400 mb-1 text-center">
                      {s === "WH" ? "창고" : s}
                    </span>
                    <input
                      className={input + " text-center"}
                      inputMode="numeric"
                      placeholder="0"
                      value={qty[s]}
                      onChange={(e) => setQty({ ...qty, [s]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                SKU·바코드는 저장 시 자동 생성: 오늘 날짜(YYMMDD) + 카테고리 코드 + 순번.
                기존 채번 규칙과 동일합니다.
              </p>
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              onClick={submit}
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-3"
            >
              {busy ? "등록 중… (POS 반영 포함)" : "저장 — POS와 시스템에 동시 등록"}
            </button>
          </>
        )}
      </main>
    </div>
  );
}
