import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("rememberMe") !== "false";
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) nav({ to: "/dashboard" });
  }, [session, loading, nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    localStorage.setItem("rememberMe", String(rememberMe));
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      toast.error("فشل تسجيل الدخول", { description: error.message });
      return;
    }
    localStorage.setItem("rememberMe", String(rememberMe));
    toast.success("تم تسجيل الدخول");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-muted px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="rounded-full bg-primary/10 p-3 text-primary"><Building2 className="size-7" /></div>
          <h1 className="text-2xl font-bold">نظام سوسكو المحاسبي</h1>
          <p className="text-sm text-muted-foreground">تسجيل الدخول للنظام</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "جاري الدخول..." : "تسجيل الدخول"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ليس لديك حساب؟{" "}
            <Link to="/signup" className="text-primary font-medium hover:underline">إنشاء حساب جديد</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
