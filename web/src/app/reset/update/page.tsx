"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function ResetUpdatePage() {
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // 메일 링크로 진입 시 세션이 붙었는지 확인
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setReady(true);
      else
        setMsg(
          "재설정 링크가 유효하지 않거나 만료되었습니다. 다시 요청해주세요."
        );
    });
  }, []);

  async function update() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setMsg("실패: " + error.message);
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-7 shadow-sm">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white mb-5">
          새 비밀번호 설정
        </h1>
        <input
          type="password"
          placeholder="새 비밀번호 (6자 이상)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          disabled={!ready}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500 disabled:opacity-40"
        />
        <button
          onClick={update}
          disabled={busy || !ready || pw.length < 6}
          className="mt-3 w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5"
        >
          변경하고 로그인
        </button>
        {msg && (
          <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">{msg}</p>
        )}
        <a href="/reset" className="block mt-5 text-xs text-neutral-400 hover:underline">
          ← 재설정 메일 다시 요청
        </a>
      </div>
    </main>
  );
}
