import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Building2, KeyRound, Mail } from "lucide-react";
import { listLoginUsers, resolveLoginEmail } from "@/lib/users-admin.functions";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [busy, setBusy] = useState(false);

  // PIN form
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");

  // Email form (admin backdoor)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const fetchUsers = useServerFn(listLoginUsers);
  const resolveEmail = useServerFn(resolveLoginEmail);
  const { data: users } = useQuery({
    queryKey: ["login-users"],
    queryFn: () => fetchUsers(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!loading && session) nav({ to: "/dashboard" });
  }, [session, loading, nav]);

  async function onPinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return toast.error("اختر المستخدم");
    if (!/^\d{6}$/.test(pin)) return toast.error("PIN يجب أن يكون 6 أرقام");
    const selected = (users ?? []).find((u) => u.id === userId);
    if (!selected) return toast.error("المستخدم غير موجود");
    setBusy(true);
    try {
      const { email: synth } = await resolveEmail({ data: { username: selected.username } });
      const { error } = await supabase.auth.signInWithPassword({ email: synth, password: pin });
      if (error) throw error;
      toast.success("تم تسجيل الدخول");
      nav({ to: "/dashboard" });
    } catch (err: any) {
      toast.error("فشل تسجيل الدخول", { description: err?.message ?? "" });
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error("فشل تسجيل الدخول", { description: error.message });
    toast.success("تم تسجيل الدخول");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-muted px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="rounded-full bg-primary/10 p-3 text-primary"><Building2 className="size-7" /></div>
          <h1 className="text-2xl font-bold">نظام سوسكو المحاسبي</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "pin" ? "اختر اسمك وأدخل رمز PIN" : "دخول المدير بالبريد الإلكتروني"}
          </p>
        </div>

        {mode === "pin" ? (
          <form onSubmit={onPinSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>المستخدم</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="اختر اسمك" /></SelectTrigger>
                <SelectContent>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                  {(users ?? []).length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      لا يوجد مستخدمون — استخدم دخول المدير
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">رمز PIN (6 أرقام)</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                dir="ltr"
                className="text-center tracking-[0.5em] text-lg"
                placeholder="••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              <KeyRound className="size-4" /> {busy ? "جاري الدخول..." : "تسجيل الدخول"}
            </Button>
            <button type="button" onClick={() => setMode("email")}
              className="block w-full text-center text-xs text-muted-foreground hover:text-primary">
              دخول المدير بالبريد الإلكتروني
            </button>
          </form>
        ) : (
          <form onSubmit={onEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} dir="ltr" />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              <Mail className="size-4" /> {busy ? "جاري الدخول..." : "تسجيل الدخول"}
            </Button>
            <button type="button" onClick={() => setMode("pin")}
              className="block w-full text-center text-xs text-muted-foreground hover:text-primary">
              العودة لدخول PIN
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
