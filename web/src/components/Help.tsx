"use client";

import { useState } from "react";

export default function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle print:hidden">
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
          className="absolute z-40 left-1/2 -translate-x-1/2 top-6 w-64 bg-neutral-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl font-normal normal-case whitespace-normal text-left cursor-pointer"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export const SKU_HELP =
  "SKU 읽는 법 — 예) 2502100501 = 25(연도) + 0210(입고일 2/10) + 05(카테고리) + 01(그날 순번). 카테고리: 01 귀걸이 · 02 목걸이 · 03 팔찌/뱅글 · 04 반지 · 05 기타. 8자리 구형은 연도 없이 입고일부터 시작합니다.";
