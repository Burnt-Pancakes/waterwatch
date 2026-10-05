import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fourMileRunSites } from "@/lib/seed/fourMileRunSites";

/**
 * Development-only seed endpoint.
 *
 * POST /api/seed -> upserts the Four Mile Run seed sites by `slug`.
 * Returns 403 in production so the route is inert on the published app.
 *
 * We check NODE_ENV inside the handler (not at module scope) because
 * env values can differ between SSR build and the running Worker.
 */
export const Route = createFileRoute("/api/seed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Hard-disable in production — seeding bypasses RLS via supabaseAdmin
        // and should never be reachable from a published deployment.
        if (process.env.NODE_ENV === "production") {
          return new Response(JSON.stringify({ error: "Seed route disabled in production" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Auth fallback: even outside production, require a shared bearer
        // secret so the route can't be triggered by an unauthenticated caller
        // if NODE_ENV is ever misconfigured or the route is hit against a
        // production-pointed Supabase project from a staging environment.
        const seedSecret = process.env.SEED_SECRET;
        if (!seedSecret) {
          return new Response(
            JSON.stringify({ error: "Seed route disabled: SEED_SECRET not configured" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        const auth = request.headers.get("authorization") ?? "";
        const expected = `Bearer ${seedSecret}`;
        if (auth.length !== expected.length || auth !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Upsert on slug so repeated calls are idempotent during dev.
        const { data, error } = await supabaseAdmin
          .from("sites")
          .upsert(fourMileRunSites, { onConflict: "slug" })
          .select("id, slug");

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return Response.json({ inserted: data?.length ?? 0, sites: data });
      },
    },
  },
});
