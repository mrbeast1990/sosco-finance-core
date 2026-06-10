import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Prefetches essential lookup data so the app remains usable offline.
 * Results are persisted to localStorage via PWAProvider's react-query persister.
 *
 * Essentials: projects, assets, expense categories, cash accounts,
 * funding checks (read-only), user profile, permissions.
 */
export function usePrefetchEssentials() {
  const qc = useQueryClient();
  const { session } = useAuth();

  useEffect(() => {
    if (!session || typeof navigator === "undefined" || !navigator.onLine) return;

    const prefetch = async () => {
      await Promise.allSettled([
        qc.prefetchQuery({
          queryKey: ["offline-cache", "projects"],
          queryFn: async () => {
            const { data } = await supabase.from("projects").select("*").is("deleted_at", null);
            return data ?? [];
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "assets"],
          queryFn: async () => {
            const { data } = await supabase.from("assets").select("*");
            return data ?? [];
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "expense_categories"],
          queryFn: async () => {
            const { data } = await supabase.from("expense_categories").select("*");
            return data ?? [];
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "cash_accounts"],
          queryFn: async () => {
            const { data } = await supabase.from("cash_accounts").select("*");
            return data ?? [];
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "funding_checks"],
          queryFn: async () => {
            const { data } = await supabase.from("funding_checks").select("*");
            return data ?? [];
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "profile", session.user.id],
          queryFn: async () => {
            const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
            return data;
          },
        }),
        qc.prefetchQuery({
          queryKey: ["offline-cache", "permissions"],
          queryFn: async () => {
            const { data } = await supabase.rpc("my_permissions");
            return data ?? [];
          },
        }),
      ]);
      try {
        localStorage.setItem("sosco_offline_cache_ready", "1");
        localStorage.setItem("sosco_offline_cache_at", String(Date.now()));
      } catch {}
    };

    void prefetch();
  }, [qc, session]);
}

export function hasOfflineCache(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("sosco_offline_cache_ready") === "1";
  } catch {
    return false;
  }
}

export function offlineCacheTimestamp(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem("sosco_offline_cache_at");
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
