"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMsg("로그인 실패: " + error.message);
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  async function signUp() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setMsg("가입 실패: " + error.message);
    } else if (!data.session) {
      setMsg("확인 메일을 보냈습니다. 메일함에서 링크를 눌러 인증 후 로그인하세요.");
    } else {
      window.location.href = "/";
      return;
    }
    setBusy(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-7 shadow-sm">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white">
          Whisper of Spring
        </h1>
        <p className="text-sm text-neutral-500 mb-6">운영 허브 로그인</p>
        <div className="space-y-3">
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signIn()}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2.5 text-sm text-neutral-900 dark:text-white outline-none focus:border-blue-500"
          />
          <button
            onClick={signIn}
            disabled={busy || !email || !password}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5"
          >
            로그인
          </button>
          <button
            onClick={signUp}
            disabled={busy || !email || !password}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 text-sm py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            처음이면: 계정 만들기
          </button>
        </div>
        {msg && (
          <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">{msg}</p>
        )}
        <p className="mt-6 text-xs text-neutral-400">
          가입 즉시 권한이 자동 배정됩니다 (오너/관리자 이메일은 사전 등록됨).
          직원 계정은 기본 Staff 권한입니다.
        </p>
      </div>
    </main>
  );
}
