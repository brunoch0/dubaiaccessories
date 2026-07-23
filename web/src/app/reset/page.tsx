"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestReset() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset/update`,
    });
    setMsg(
      error
        ? "실패: " + error.message
        : "재설정 메일을 보냈습니다. 메일함에서 링크를 눌러주세요."
    );
    setBusy(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-7 shadow-sm">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white mb-1">
          비밀번호 재설정
        </h1>
        <p className="text-sm text-neutral-500 mb-5">
          가입한 이메일로 재설정 링크를 보냅니다.
        </p>
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500"
        />
        <button
          onClick={requestReset}
          disabled={busy || !email}
          className="mt-3 w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5"
        >
          재설정 메일 보내기
        </button>
        {msg && (
          <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">{msg}</p>
        )}
        <a href="/login" className="block mt-5 text-xs text-neutral-400 hover:underline">
          ← 로그인으로 돌아가기
        </a>
      </div>
    </main>
  );
}
