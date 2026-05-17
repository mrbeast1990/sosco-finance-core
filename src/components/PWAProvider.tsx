import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { processQueue } from "@/lib/offline-queue";
import { toast } from "sonner";

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Cache reads to localStorage for offline access
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const persister = createSyncStoragePersister({
        storage: window.localStorage,
        key: "sosco_rq_cache_v1",
        throttleTime: 1000,
      });
      persistQueryClient({
        queryClient: queryClient as any,
        persister,
        maxAge: ONE_WEEK,
        buster: "v1",
      });
    } catch {
      // localStorage may be blocked; ignore
    }
  }, [queryClient]);

  // Register service worker (guarded against preview/iframe)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    const host = window.location.hostname;
    const isPreview =
      host.includes("id-preview--") ||
      host.includes("lovableproject.com") ||
      host === "localhost" ||
      host === "127.0.0.1";

    if (isIframe || isPreview) {
      // Clean up any stale SW from a prior visit in preview/iframe
      navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }

    // Dynamic import so dev/SSR never touches the virtual module
    import(/* @vite-ignore */ "virtual:pwa-register")
      .then(({ registerSW }: any) => {
        registerSW({ immediate: true });
      })
      .catch(() => {});
  }, []);

  // Auto-process queue when coming back online
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = async () => {
      const res = await processQueue();
      if (res.ok > 0) {
        toast.success(`تمت مزامنة ${res.ok} عملية`);
        queryClient.invalidateQueries();
      }
      if (res.failed > 0) {
        toast.error(`فشلت مزامنة ${res.failed} عملية`, {
          description: "راجع شاشة العمليات المعلقة",
        });
      }
    };
    window.addEventListener("online", handler);
    // Initial attempt if we start online with pending items
    if (navigator.onLine) void handler();
    return () => window.removeEventListener("online", handler);
  }, [queryClient]);

  return <>{children}</>;
}
