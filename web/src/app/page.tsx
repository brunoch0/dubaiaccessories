"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { createClient } from "@/lib/supabase";

type Stats = {
  products: number;
  mcc: number;
  moe: number;
  negatives: number;
  costValue: number | null; // null = 권한 없음(staff)
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [{ count: products }, invRes, costRes] = await Promise.all([
        supabase.from("products").select("*", { count: "exact", head: true }),
        supabase.from("inventory").select("product_id,store,qty").range(0, 4999),
        supabase.from("product_costs").select("product_id,cost").range(0, 4999),
      ]);
      const inv = invRes.data ?? [];
      const mcc = inv.filter((r) => r.store === "MCC").reduce((a, r) => a + r.qty, 0);
      const moe = inv.filter((r) => r.store === "MOE").reduce((a, r) => a + r.qty, 0);
      const negatives = inv.filter((r) => r.qty < 0).length;

      let costValue: number | null = null;
      if (costRes.data && costRes.data.length > 0) {
        const costMap = new Map(costRes.data.map((c) => [c.product_id, c.cost ?? 0]));
        const qtyByProduct = new Map<string, number>();
        inv.forEach((r) =>
          qtyByProduct.set(r.product_id, (qtyByProduct.get(r.product_id) ?? 0) + r.qty)
        );
        costValue = 0;
        qtyByProduct.forEach((qty, pid) => {
          if (qty > 0) costValue! += (costMap.get(pid) ?? 0) * qty;
        });
      }
      setS({ products: products ?? 0, mcc, moe, negatives, costValue });
    })();
  }, []);

  const tile = (label: string, value: string, cls = "") => (
    <div
      key={label}
      className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 text-neutral-900 dark:text-white ${cls}`}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white mb-4">
          대시보드
        </h1>
        {!s ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tile("등록 상품", fmt(s.products) + "개")}
              {tile("MCC 재고", fmt(s.mcc) + "개")}
              {tile("MOE 재고", fmt(s.moe) + "개")}
              {tile(
                "마이너스 재고",
                s.negatives + "건",
                s.negatives > 0 ? "!text-red-600" : ""
              )}
            </div>
            {s.costValue !== null && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                {tile(
                  "재고 원가액 (오너/관리자 전용)",
                  "AED " + fmt(Math.round(s.costValue))
                )}
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <Link
                href="/inventory"
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5"
              >
                재고 조회 →
              </Link>
              <Link
                href="/inventory?status=neg"
                className="rounded-lg border border-red-300 dark:border-red-900 text-red-600 text-sm font-semibold px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-950"
              >
                마이너스 {s.negatives}건 보기
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
