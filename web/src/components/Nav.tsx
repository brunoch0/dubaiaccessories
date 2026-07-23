"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

const ROLE_LABEL: Record<string, string> = {
  owner: "오너",
  admin: "관리자",
  staff: "직원",
};

export default function Nav() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setMe({ email: user.email ?? "", role: data?.role ?? "staff" });
    });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const tab = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-sm ${
        pathname === href
          ? "bg-blue-600 text-white font-semibold"
          : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 bg-white/85 dark:bg-neutral-950/85 backdrop-blur border-b border-neutral-200 dark:border-neutral-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
        <span className="font-bold text-neutral-900 dark:text-white mr-2 whitespace-nowrap">
          WoS 운영허브
        </span>
        {tab("/", "대시보드")}
        {tab("/inventory", "재고")}
        <div className="ml-auto flex items-center gap-3">
          {me && (
            <span className="hidden sm:block text-xs text-neutral-500">
              {me.email} ·{" "}
              <b className="text-blue-600 dark:text-blue-400">
                {ROLE_LABEL[me.role] ?? me.role}
              </b>
            </span>
          )}
          <button
            onClick={signOut}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white border border-neutral-300 dark:border-neutral-700 rounded-full px-3 py-1"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
