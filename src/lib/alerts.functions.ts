import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ALL_ALERT_TRIGGERS } from "@/lib/alertTriggers";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const triggerOnValues = ALL_ALERT_TRIGGERS;

const upsertSchema = z.object({
  siteId: z.string().uuid(),
  triggerOn: z.array(z.enum(triggerOnValues)),
  isActive: z.boolean().optional().default(true),
});

export const getAlertConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: alert } = await supabaseAdmin
      .from("alerts")
      .select("id, site_id, trigger_on, is_active")
      .eq("user_id", userId)
      .eq("site_id", data.siteId)
      .maybeSingle();
    return alert ?? null;
  });

export const upsertAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: result, error } = await supabaseAdmin
      .from("alerts")
      .upsert(
        {
          user_id: userId,
          site_id: data.siteId,
          trigger_on: data.triggerOn,
          is_active: data.isActive ?? true,
        },
        { onConflict: "user_id,site_id" },
      )
      .select("id, site_id, trigger_on, is_active")
      .single();
    if (error) throw new Error(error.message);
    return result;
  });

export const deleteAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("alerts")
      .delete()
      .eq("user_id", userId)
      .eq("site_id", data.siteId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listMyAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("alerts")
      .select("id, site_id, trigger_on, is_active, created_at, sites(name, slug)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => {
      const site = a.sites as { name: string; slug: string } | null;
      return {
        id: a.id,
        siteId: a.site_id,
        siteName: site?.name ?? "Unknown site",
        siteSlug: site?.slug ?? "",
        triggerOn: a.trigger_on,
        isActive: a.is_active,
      };
    });
  });

export const toggleAlertActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ alertId: z.string().uuid(), isActive: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("alerts")
      .update({ is_active: data.isActive })
      .eq("id", data.alertId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteAlertById = createServerFn({ method: "POST" })
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
