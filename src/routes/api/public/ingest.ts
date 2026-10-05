/**
 * Public ingestion endpoint.
 *
 * Called by Supabase `pg_cron` (via `pg_net.http_post`) on a schedule and
 * by humans during dev. Authenticated with a shared CRON_SECRET passed as
 * `Authorization: Bearer <secret>` — this endpoint lives under `/api/public/`
 * so Lovable's published-site auth does NOT gate it, hence the manual check.
 *
 * Request body (optional): `{ "sourceId": "noaa_rain" }`
 * Response: 200 with {@link IngestionResult} JSON.
 */

import { createFileRoute } from "@tanstack/react-router";
import { runIngestion } from "@/lib/ingest.server";

/**
 * Constant-time-ish header equality. We compare lengths first to short-
 * circuit obviously-wrong values, then fall back to a per-char compare
 * that always loops the full length of the expected secret.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(JSON.stringify({ error: "CRON_SECRET not configured on server" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const header = request.headers.get("authorization") ?? "";
        const presented = header.toLowerCase().startsWith("bearer ")
          ? header.slice(7).trim()
          : header.trim();
        if (!presented || !safeEqual(presented, expected)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let sourceId: string | undefined;
        try {
          // Body is optional — empty body is a valid "run everything" call.
          const text = await request.text();
          if (text) {
            const body = JSON.parse(text) as { sourceId?: unknown };
            if (typeof body.sourceId === "string") sourceId = body.sourceId;
          }
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const result = await runIngestion(sourceId);
        return Response.json(result);
      },
    },
  },
});
