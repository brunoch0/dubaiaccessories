import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// PostgREST caps responses at 1,000 rows — page through until exhausted.
export async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}
