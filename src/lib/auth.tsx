import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  permissions: Set<string>;
  loading: boolean;
  can: (code: string) => boolean;
  canWrite: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  async function loadPermissions() {
    const { data, error } = await supabase.rpc("my_permissions");
    if (error) {
      console.error("my_permissions failed", error);
      setPermissions(new Set());
      return;
    }
    setPermissions(new Set((data ?? []).map((r: { code: string }) => r.code)));
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) setTimeout(() => loadPermissions(), 0);
      else setPermissions(new Set());
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadPermissions().finally(() => setLoading(false));
      else setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const can = (code: string) => permissions.has(code);

  const value: AuthCtx = {
    user: session?.user ?? null,
    session,
    permissions,
    loading,
    can,
    canWrite: can("expenses.create") || can("funders.create") || can("projects.create"),
    isAdmin: can("users.manage"),
    signOut: async () => { await supabase.auth.signOut(); },
    refresh: loadPermissions,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

export function Can({ perm, children, fallback = null }: { perm: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(perm) ? children : fallback}</>;
}
