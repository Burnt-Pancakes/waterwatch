import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getUserProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data } = await supabaseAdmin
      .from("user_profiles")
      .select("id, display_name, email_alerts_enabled")
      .eq("id", userId)
      .maybeSingle();
    return data ?? null;
  });

export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        displayName: z.string().max(80).nullable().optional(),
        emailAlertsEnabled: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.emailAlertsEnabled !== undefined) patch.email_alerts_enabled = data.emailAlertsEnabled;

    const { error } = await supabaseAdmin
      .from("user_profiles")
      .upsert({ id: userId, ...patch }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listUserAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("alerts")
      .select("id, site_id, trigger_on, is_active, sites(name, slug)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      siteId: row.site_id,
      siteName: (row.sites as { name: string } | null)?.name ?? "Unknown site",
      siteSlug: (row.sites as { slug: string } | null)?.slug ?? "",
      triggerOn: row.trigger_on as string[],
    }));
  });

export const deleteUserAlertById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ alertId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("alerts")
      .delete()
      .eq("id", data.alertId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
