"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number | null;
  barcode: string | null;
};
type Stock = { MCC: number; MOE: number; WH: number };

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [store, setStore] = useState<"MCC" | "MOE">("MCC");
  const [product, setProduct] = useState<Product | null>(null);
  const [stock, setStock] = useState<Stock>({ MCC: 0, MOE: 0, WH: 0 });
  const [cost, setCost] = useState<number | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deductReason, setDeductReason] = useState("");
  const [countQty, setCountQty] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("wos-store");
    if (saved === "MCC" || saved === "MOE") setStore(saved);
    return () => controlsRef.current?.stop();
  }, []);

  function setStorePersist(s: "MCC" | "MOE") {
    setStore(s);
    localStorage.setItem("wos-store", s);
  }

  async function startScan() {
    setCamError(null);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (lastRef.current.code === code && now - lastRef.current.at < 3000) return;
          lastRef.current = { code, at: now };
          if (navigator.vibrate) navigator.vibrate(80);
          lookup(code);
        }
      );
      controlsRef.current = controls;
      setScanning(true);
    } catch (e) {
      setCamError(
        "카메라를 열 수 없습니다 (권한 거부 또는 미지원). 아래에 바코드 숫자를 직접 입력하세요."
      );
    }
  }

  function stopScan() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  async function lookup(code: string) {
    const supabase = createClient();
    setNotFound(null);
    const c = code.trim();
    const { data } = await supabase
      .from("products")
      .select("id,sku,name,category,price,barcode")
      .or(`barcode.eq.${c},sku.eq.${c}`)
      .limit(1);
    if (!data || data.length === 0) {
      setProduct(null);
      setNotFound(c);
      return;
    }
    const p = data[0] as Product;
    setProduct(p);
    await refreshStock(p.id);
    const { data: cd } = await supabase
      .from("product_costs")
      .select("cost")
      .eq("product_id", p.id);
    setCost(cd && cd.length > 0 ? cd[0].cost : null);
  }

  async function refreshStock(productId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory")
      .select("store,qty")
      .eq("product_id", productId);
    const s: Stock = { MCC: 0, MOE: 0, WH: 0 };
    (data ?? []).forEach((r) => (s[r.store as keyof Stock] = r.qty));
    setStock(s);
  }

  async function addMovement(
    type: "sale" | "deduct" | "adjust",
    qty: number,
    reason?: string
  ) {
    if (!product) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("movements").insert({
      product_id: product.id,
      store,
      type,
      qty,
      reason: reason ?? null,
      created_by: user?.id ?? null,
    });
    if (error) {
      setToast("실패: " + error.message);
    } else {
      await refreshStock(product.id);
      setToast(
        type === "sale"
          ? `판매 -${qty} 기록됨 (${store})`
          : type === "deduct"
          ? `차감 -${qty} 기록됨 (${reason})`
          : `실사 조정 완료 (${store})`
      );
      setDeductReason("");
      setCountQty("");
    }
    setBusy(false);
    setTimeout(() => setToast(null), 2500);
  }

  async function applyCount() {
    const actual = parseInt(countQty, 10);
    if (isNaN(actual) || !product) return;
    const delta = actual - stock[store];
    if (delta === 0) {
      setToast("차이 없음 — 조정 불필요");
      setTimeout(() => setToast(null), 2000);
      return;
    }
    await addMovement("adjust", delta, `실사: ${stock[store]} → ${actual}`);
  }

  const qtyCls = (n: number) =>
    n < 0 ? "text-red-600" : n === 0 ? "text-neutral-400" : "";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 pb-24">
      <Nav />
      <main className="max-w-xl mx-auto px-4 py-5">
        {/* 매장 선택 */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-neutral-500">내 매장:</span>
          {(["MCC", "MOE"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStorePersist(s)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold ${
                store === s
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 카메라 */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {!scanning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={startScan}
                className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3"
              >
                📷 스캔 시작
              </button>
            </div>
          )}
          {scanning && (
            <button
              onClick={stopScan}
              className="absolute top-3 right-3 rounded-full bg-black/60 text-white text-xs px-3 py-1.5"
            >
              중지
            </button>
          )}
        </div>
        {camError && <p className="mt-2 text-sm text-amber-600">{camError}</p>}

        {/* 수동 입력 */}
        <div className="flex gap-2 mt-3">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && manual && lookup(manual)}
            placeholder="바코드/SKU 직접 입력"
            inputMode="numeric"
            className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500"
          />
          <button
            onClick={() => manual && lookup(manual)}
            className="rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-black text-sm font-semibold px-4"
          >
            조회
          </button>
        </div>

        {notFound && (
          <p className="mt-3 text-sm text-red-600">
            &quot;{notFound}&quot; 에 해당하는 상품이 없습니다.
          </p>
        )}

        {/* 상품 카드 */}
        {product && (
          <div className="mt-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
            <h2 className="font-bold text-neutral-900 dark:text-white">{product.name}</h2>
            <p className="text-xs text-neutral-500 mb-3">
              {product.category} · SKU {product.sku}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              {(["MCC", "MOE", "WH"] as const).map((s) => (
                <div
                  key={s}
                  className={`rounded-lg py-2 ${
                    s === store
                      ? "bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-800"
                      : "bg-neutral-50 dark:bg-neutral-800"
                  }`}
                >
                  <div className="text-[11px] text-neutral-500">{s}</div>
                  <div className={`text-lg font-bold ${qtyCls(stock[s])}`}>{stock[s]}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm mb-4">
              <span className="text-neutral-500">
                판매가 <b className="text-neutral-900 dark:text-white">{fmt(product.price)}</b>
              </span>
              {cost !== null && (
                <span className="text-neutral-500">
                  원가 <b className="text-neutral-900 dark:text-white">{fmt(cost)}</b>
                  {product.price && cost ? (
                    <span className="ml-2 text-blue-600">
                      마진 {Math.round(((product.price - cost) / product.price) * 100)}%
                    </span>
                  ) : null}
                </span>
              )}
            </div>

            {/* 액션 */}
            <div className="space-y-2">
              <button
                onClick={() => addMovement("sale", 1)}
                disabled={busy}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-3"
              >
                🛍️ 판매 1개 ({store})
              </button>
              <div className="flex gap-2">
                <input
                  value={deductReason}
                  onChange={(e) => setDeductReason(e.target.value)}
                  placeholder="차감 사유 (파손/변색/세척...)"
                  className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:text-white"
                />
                <button
                  onClick={() => addMovement("deduct", 1, deductReason || "기타")}
                  disabled={busy}
                  className="rounded-lg border border-red-300 dark:border-red-900 text-red-600 text-sm font-semibold px-4 disabled:opacity-40"
                >
                  차감 -1
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={countQty}
                  onChange={(e) => setCountQty(e.target.value)}
                  placeholder={`실사 수량 (현재 ${store} ${stock[store]}개)`}
                  inputMode="numeric"
                  className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm text-neutral-900 dark:text-white"
                />
                <button
                  onClick={applyCount}
                  disabled={busy || countQty === ""}
                  className="rounded-lg border border-neutral-400 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 text-sm font-semibold px-4 disabled:opacity-40"
                >
                  실사 반영
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white text-sm px-5 py-2.5 rounded-full shadow-lg">
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}
