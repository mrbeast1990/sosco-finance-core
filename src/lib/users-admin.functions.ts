import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYNTHETIC_DOMAIN = "sosco.local";
const usernameRx = /^[a-zA-Z0-9_.-]{3,32}$/;
const pinRx = /^\d{6}$/;

function syntheticEmail(username: string) {
  return `${username.toLowerCase()}@${SYNTHETIC_DOMAIN}`;
}

/** Public: list active users for the login dropdown (no PII beyond name). */
export const listLoginUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, username, full_name")
    .eq("is_active", true)
    .not("username", "is", null)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    username: p.username as string,
    full_name: (p.full_name ?? p.username) as string,
  }));
});

/** Public: resolve username -> synthetic email so the client can sign in with the PIN as password. */
export const resolveLoginEmail = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string }) =>
    z.object({ username: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const uname = data.username.trim().toLowerCase();
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, username, is_active")
      .ilike("username", uname)
      .maybeSingle();
    if (!prof || !prof.is_active) {
      // Generic message; do not leak existence
      throw new Error("بيانات الدخول غير صحيحة");
    }
    return { email: syntheticEmail(prof.username as string) };
  });

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("is_admin", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("غير مصرح: صلاحيات المدير مطلوبة");
}

/** Admin: create user with username + 6-digit PIN + role. */
export const adminCreateUserWithPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    username: string;
    full_name: string;
    pin: string;
    role_id: string;
  }) =>
    z
      .object({
        username: z.string().regex(usernameRx, "اسم المستخدم: 3-32 حرف/رقم"),
        full_name: z.string().trim().min(1).max(120),
        pin: z.string().regex(pinRx, "PIN يجب أن يكون 6 أرقام"),
        role_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const uname = data.username.toLowerCase();
    const email = syntheticEmail(uname);

    // Uniqueness
    const { data: existing } = await supabaseAdmin
      .from("profiles").select("id").ilike("username", uname).maybeSingle();
    if (existing) throw new Error("اسم المستخدم مستخدم بالفعل");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.pin,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, username: uname },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "فشل إنشاء المستخدم");

    const newId = created.user.id;
    // handle_new_user trigger created the profile; update it
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ username: uname, full_name: data.full_name, email })
      .eq("id", newId);
    if (pErr) throw new Error(pErr.message);

    // Replace default role with chosen role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles").insert({ user_id: newId, role_id: data.role_id });
    if (rErr) throw new Error(rErr.message);

    return { id: newId };
  });

/** Admin: reset a user's 6-digit PIN. */
export const adminResetPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; pin: string }) =>
    z.object({
      user_id: z.string().uuid(),
      pin: z.string().regex(pinRx, "PIN يجب أن يكون 6 أرقام"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.pin,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
