"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase";

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
  const [vat, setVat] = useState(true);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [primaryIdx, setPrimaryIdx] = useState(0);
  const [aiIdx, setAiIdx] = useState<number | null>(null); // 배경 선택 패널 열린 사진
  const [aiBusy, setAiBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  const BGS: [string, string][] = [
    ["화이트", "#ffffff"],
    ["크림", "#faf6f0"],
    ["라이트그레이", "#f3f4f6"],
    ["핑크 그라디언트", "gradient"],
    ["블랙", "#151515"],
  ];

  // AI 스튜디오 컷: 배경 제거(브라우저 AI) → 배경 합성 → 1200px 정방형 고품질 출력
  async function studioCut(idx: number, bg: string) {
    setAiBusy(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const cut = await removeBackground(photos[idx].file);
      const img = await createImageBitmap(cut);
      const S = 1200;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d")!;
      if (bg === "gradient") {
        const g = ctx.createLinearGradient(0, 0, S, S);
        g.addColorStop(0, "#fdf2f8");
        g.addColorStop(1, "#fbcfe8");
        ctx.fillStyle = g;
      } else ctx.fillStyle = bg;
      ctx.fillRect(0, 0, S, S);
      const pad = S * 0.12;
      const scale = Math.min((S - 2 * pad) / img.width, (S - 2 * pad) / img.height);
      const w = img.width * scale,
        h = img.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      await new Promise<void>((resolve) =>
        canvas.toBlob(
          (b) => {
            if (b) {
              const f = new File([b], `studio_${idx}.jpg`, { type: "image/jpeg" });
              setPhotos((ps) =>
                ps.map((p, i) =>
                  i === idx ? { file: f, preview: URL.createObjectURL(b) } : p
                )
              );
            }
            resolve();
          },
          "image/jpeg",
          0.92
        )
      );
      setAiIdx(null);
    } catch (e) {
      setErr("AI 처리 실패: " + (e instanceof Error ? e.message : String(e)));
    }
    setAiBusy(false);
  }

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
          vat,
        }),
      });
      const j = await res.json();
      if (!j.ok) setErr(j.error);
      else {
        // 사진들 업로드 → product_images + 대표사진 연결
        if (photos.length > 0 && j.product_id) {
          const supabase = createClient();
          let primaryUrl: string | null = null;
          let okCount = 0;
          for (let i = 0; i < photos.length; i++) {
            const path = `${j.sku}/${i + 1}.jpg`;
            const { error: upErr } = await supabase.storage
              .from("product-images")
              .upload(path, photos[i].file, {
                upsert: true,
                contentType: photos[i].file.type || "image/jpeg",
              });
            if (upErr) continue;
            const { data: pub } = supabase.storage
              .from("product-images")
              .getPublicUrl(path);
            await supabase.from("product_images").insert({
              product_id: j.product_id,
              url: pub.publicUrl,
              sort: i,
              is_primary: i === primaryIdx,
            });
            if (i === primaryIdx) primaryUrl = pub.publicUrl;
            okCount++;
          }
          if (primaryUrl)
            await supabase
              .from("products")
              .update({ image_url: primaryUrl })
              .eq("id", j.product_id);
          setPhotoNote(
            `사진 ${okCount}장 등록 완료 (대표 1장 지정). POS 타일 이미지는 Loyverse 앱에서 별도 지정.`
          );
        }
        setDone({ sku: j.sku, barcode: j.barcode });
      }
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
    setPhotos([]);
    setPrimaryIdx(0);
    setAiIdx(null);
    setPhotoNote(null);
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
            {photoNote && (
              <p className="mt-3 text-xs text-neutral-500">{photoNote}</p>
            )}
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

            <div className={card}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white">
                    세금 — VAT (5%)
                  </span>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Loyverse의 VAT 설정을 이 상품에 적용합니다
                  </p>
                </div>
                <button
                  onClick={() => setVat(!vat)}
                  className={`w-12 h-7 rounded-full transition-colors ${
                    vat ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`block w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                      vat ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className={card}>
              <span className={label}>상품 사진 (여러 장 가능 · ⭐ = 대표사진)</span>
              <div className="flex items-center gap-3 mt-1">
                <label className="rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm text-neutral-700 dark:text-neutral-300 px-4 py-2.5 cursor-pointer hover:border-blue-500">
                  📷 촬영 / 선택 (여러 장)
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      setPhotos((ps) => [
                        ...ps,
                        ...fs.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
                      ]);
                    }}
                  />
                </label>
              </div>

              {photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
                  {photos.map((p, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.preview}
                        alt=""
                        className={`w-full aspect-square rounded-lg object-cover border-2 ${
                          i === primaryIdx
                            ? "border-amber-400"
                            : "border-neutral-200 dark:border-neutral-700"
                        }`}
                      />
                      <button
                        onClick={() => setPrimaryIdx(i)}
                        title="대표사진 지정"
                        className={`absolute top-1 left-1 w-6 h-6 rounded-full text-xs flex items-center justify-center ${
                          i === primaryIdx
                            ? "bg-amber-400 text-white"
                            : "bg-black/40 text-white/80"
                        }`}
                      >
                        ⭐
                      </button>
                      <button
                        onClick={() => {
                          setPhotos((ps) => ps.filter((_, x) => x !== i));
                          if (primaryIdx >= i && primaryIdx > 0)
                            setPrimaryIdx(primaryIdx - 1);
                          if (aiIdx === i) setAiIdx(null);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/40 text-white text-xs"
                      >
                        ✕
                      </button>
                      <button
                        onClick={() => setAiIdx(aiIdx === i ? null : i)}
                        disabled={aiBusy}
                        className="absolute bottom-1 left-1 right-1 rounded-md bg-black/55 backdrop-blur text-white text-[11px] py-1 disabled:opacity-40"
                      >
                        🎨 AI 스튜디오 컷
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {aiIdx !== null && (
                <div className="mt-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-3">
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 mb-2">
                    {aiBusy
                      ? "AI가 배경을 제거하고 있습니다… (첫 실행은 모델 다운로드로 30초쯤 걸려요)"
                      : "배경을 선택하면: 배경 제거 → 새 배경 합성 → 쇼핑몰용 1200px 정방형으로 만들어줍니다."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BGS.map(([bgName, v]) => (
                      <button
                        key={bgName}
                        disabled={aiBusy}
                        onClick={() => studioCut(aiIdx, v)}
                        className="rounded-full border border-neutral-300 dark:border-neutral-600 text-xs px-3 py-1.5 text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 disabled:opacity-40"
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-full mr-1 align-middle border border-neutral-300"
                          style={{
                            background:
                              v === "gradient"
                                ? "linear-gradient(135deg,#fdf2f8,#fbcfe8)"
                                : v,
                          }}
                        />
                        {bgName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-2 text-xs text-neutral-400">
                시스템·쇼핑몰용 사진입니다 (여러 장 저장, 대표 1장). POS 타일 이미지는
                Loyverse 앱에서 별도 지정.
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
