"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { createClient, fetchAll } from "@/lib/supabase";

type Entry = {
  id: string;
  at: string;
  kind: "sale" | "deduct" | "adjust" | "in" | "transfer" | "csv_upload" | "system";
  store: string | null;
  title: string;
  detail: string | null;
  who: string;
};

const KIND_META: Record<Entry["kind"], { icon: string; label: string }> = {
  sale: { icon: "🛍️", label: "판매" },
  deduct: { icon: "🗑️", label: "차감" },
  adjust: { icon: "📋", label: "실사조정" },
  in: { icon: "📥", label: "입고" },
  transfer: { icon: "🔁", label: "이동" },
  csv_upload: { icon: "📄", label: "CSV 업로드" },
  system: { icon: "⚙️", label: "시스템" },
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return d.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LogsPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [kind, setKind] = useState<string>("");
  const [store, setStore] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [movRes, actRes, prods, profs] = await Promise.all([
        supabase
          .from("movements")
          .select("id,product_id,store,type,qty,reason,created_by,created_at")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("activity_log")
          .select("id,type,summary,detail,created_by,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        fetchAll<{ id: string; sku: string; name: string }>(
          supabase,
          "products",
          "id,sku,name"
        ),
        fetchAll<{ id: string; email: string; full_name: string | null }>(
          supabase,
          "profiles",
          "id,email,full_name"
        ),
      ]);
      const pMap = new Map(prods.map((p) => [p.id, p]));
      const uMap = new Map(profs.map((u) => [u.id, u.full_name || u.email]));

      const fromMov: Entry[] = (movRes.data ?? []).map((m) => {
        const p = pMap.get(m.product_id);
        const kind = (
          m.type === "transfer_in" || m.type === "transfer_out" ? "transfer" : m.type
        ) as Entry["kind"];
        const sign = ["sale", "deduct", "transfer_out"].includes(m.type) ? -m.qty : m.qty;
        return {
          id: "m" + m.id,
          at: m.created_at,
          kind,
          store: m.store,
          title: `${p?.name ?? "?"} ${sign > 0 ? "+" : ""}${sign}개`,
          detail: [p ? "SKU " + p.sku : null, m.reason].filter(Boolean).join(" · ") || null,
          who: (m.created_by && uMap.get(m.created_by)) || "—",
        };
      });

      const fromAct: Entry[] = (actRes.data ?? []).map((a) => ({
        id: "a" + a.id,
        at: a.created_at,
        kind: a.type as Entry["kind"],
        store: null,
        title: a.summary,
        detail: a.detail ? Object.entries(a.detail as Record<string, unknown>)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ") : null,
        who: (a.created_by && uMap.get(a.created_by)) || "—",
      }));

      setEntries(
        [...fromMov, ...fromAct].sort(
          (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
        )
      );
    })();
  }, []);

  const filtered = useMemo(
    () =>
      (entries ?? []).filter(
        (e) => (!kind || e.kind === kind) && (!store || e.store === store)
      ),
    [entries, kind, store]
  );

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white mb-1">기록</h1>
        <p className="text-sm text-neutral-500 mb-4">
          판매·차감·실사·업로드가 시간순으로 남습니다. (누가 · 언제 · 무엇을)
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm text-neutral-900 dark:text-white"
          >
            <option value="">유형 전체</option>
            {Object.entries(KIND_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.icon} {v.label}
              </option>
            ))}
          </select>
          <select
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm text-neutral-900 dark:text-white"
          >
            <option value="">매장 전체</option>
            <option value="MCC">MCC</option>
            <option value="MOE">MOE</option>
            <option value="WH">창고</option>
          </select>
        </div>

        {!entries ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-neutral-500">
            기록이 없습니다. 스캔에서 판매/차감/실사를 입력하거나 CSV를 업로드하면 여기에
            쌓입니다.
          </p>
        ) : (
          <ol className="space-y-2">
            {filtered.map((e) => {
              const meta = KIND_META[e.kind];
              return (
                <li
                  key={e.id}
                  className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl px-4 py-3 flex items-start gap-3"
                >
                  <span className="text-lg leading-6">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {meta.label}
                        {e.store ? ` · ${e.store}` : ""}
                      </span>
                      <span className="text-xs text-neutral-400">{timeAgo(e.at)}</span>
                      <span className="text-xs text-neutral-400">· {e.who}</span>
                    </div>
                    <div className="text-sm text-neutral-900 dark:text-white truncate">
                      {e.title}
                    </div>
                    {e.detail && (
                      <div className="text-xs text-neutral-500 truncate">{e.detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
