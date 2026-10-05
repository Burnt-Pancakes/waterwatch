import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { slugify } from "@/lib/adapters/slug";

export type PersonalSite = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  owner_id: string;
};

const nameSchema = z.string().trim().min(1, "Name is required").max(120);

/** Translates raw Postgres/PostgREST errors into user-safe messages. */
function translateDbError(error: { message?: string; code?: string } | null | undefined): never {
  const code = (error as { code?: string } | null | undefined)?.code ?? "";
  const msg = error?.message ?? "";
  if (code === "23505" || /duplicate key value/i.test(msg)) {
    throw new Error("You already have a spot with that exact name and location.");
  }
  console.error("[userSites] DB error:", msg);
  throw new Error("Something went wrong. Please try again.");
}

export const listUserSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PersonalSite[]> => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("id, slug, name, description, lat, lng, owner_id")
      .eq("owner_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) translateDbError(error);
    return (data ?? []) as unknown as PersonalSite[];
  });

export const createUserSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: nameSchema,
        description: z.string().max(500).nullable().optional(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        site_type: z
          .enum(["kayak_launch", "boat_ramp", "beach", "swim_area", "fishing_access", "marina"])
          .default("kayak_launch"),
        water_body_type: z.enum(["freshwater", "tidal_brackish"]).default("freshwater"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const id = crypto.randomUUID();
    const slugBase = slugify(data.name, "");
    const slug = slugBase ? `${slugBase}-${id.slice(0, 8)}` : id.slice(0, 8);

    const { data: site, error } = await supabaseAdmin
      .from("sites")
      .insert({
        id,
        owner_id: userId,
        status: "personal",
        source: "user",
        name: data.name.trim(),
        description: data.description ?? null,
        lat: data.lat,
        lng: data.lng,
        slug,
        site_type: data.site_type,
        water_body_type: data.water_body_type,
        is_active: true,
      })
      .select()
      .single();

    if (error) translateDbError(error);
    return site;
  });

export const updateUserSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        siteId: z.string().uuid(),
        name: nameSchema,
        description: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: site, error } = await supabaseAdmin
      .from("sites")
      .update({
        name: data.name.trim(),
        description: data.description ?? null,
      })
      .eq("id", data.siteId)
      .eq("owner_id", userId)
      .select()
      .maybeSingle();

    if (error) translateDbError(error);
    if (!site) throw new Error("You can only change your own spots.");
    return site;
  });

export const deleteUserSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("sites")
      .delete()
      .eq("id", data.siteId)
      .eq("owner_id", userId);

    if (error) translateDbError(error);
    return { ok: true as const };
  });
