import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Loader2, WifiOff } from "lucide-react";
import { OfflineBadge } from "@/components/OfflineBadge";
import { OfflineBanner } from "@/components/OfflineBanner";
import { usePrefetchEssentials, hasOfflineCache } from "@/lib/use-prefetch-essentials";
import { useOnlineStatus } from "@/lib/use-online-status";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const online = useOnlineStatus();
  usePrefetchEssentials();

  useEffect(() => {
    if (!loading && !session && online) nav({ to: "/login" });
  }, [session, loading, nav, online]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!session && !online) {
    return (
      <div className="min-h-screen grid place-items-center p-6" dir="rtl">
        <div className="max-w-md text-center space-y-3">
          <WifiOff className="size-10 mx-auto text-warning" />
          <h2 className="text-lg font-semibold">لا يوجد اتصال بالإنترنت</h2>
          <p className="text-sm text-muted-foreground">
            {hasOfflineCache()
              ? "يرجى الاتصال بالإنترنت لتسجيل الدخول."
              : "لا توجد بيانات محفوظة للاستخدام بدون إنترنت. يرجى فتح التطبيق مرة واحدة أثناء الاتصال بالإنترنت."}
          </p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-card px-4 sticky top-0 z-30">
            <SidebarTrigger />
            <div className="text-sm font-medium text-muted-foreground">نظام سوسكو المحاسبي</div>
            <div className="mr-auto"><OfflineBadge /></div>
          </header>
          <OfflineBanner />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
