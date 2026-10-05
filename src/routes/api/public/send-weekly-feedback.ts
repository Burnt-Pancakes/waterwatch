/**
 * Weekly focus-group feedback digest endpoint.
 *
 * NOTE ON CONVENTION: this would normally be a Supabase edge function under
 * `supabase/functions/` (see docs/EDGE_FUNCTIONS.md). Creating NEW edge
 * functions is blocked in this project, so the report lives here as a
 * TanStack public server route instead. Auth follows the existing
 * `x-cron-secret` convention (same as ingest-cmc / fetch-water-conditions),
 * with a service-role Bearer accepted for manual runs.
 *
 * The report itself lives in src/lib/weeklyFeedback.server.ts, shared with the
 * visit-triggered catch-up backstop registered in src/start.ts.
 */

import { createFileRoute } from "@tanstack/react-router";
import { runWeeklyFeedbackReport } from "@/lib/weeklyFeedback.server";

export { buildFeedbackHtml, reportMonday, dueCutoff } from "@/lib/weeklyFeedback.server";

/** Constant-time-ish header equality (same helper shape as /api/public/ingest). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/send-weekly-feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        const cronSecret = process.env.CRON_SECRET ?? "";
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

        const presentedSecret = request.headers.get("x-cron-secret") ?? "";
        const authHeader = request.headers.get("authorization") ?? "";
        const bearer = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";

        const authorized =
          (cronSecret !== "" && presentedSecret !== "" && safeEqual(presentedSecret, cronSecret)) ||
          (serviceKey !== "" && bearer !== "" && safeEqual(bearer, serviceKey));

        if (!authorized) return json({ error: "Unauthorized" }, 401);

        // Test mode: ?test=1 or {"test": true}
        const url = new URL(request.url);
        const queryTest = ["1", "true", "yes"].includes(
          (url.searchParams.get("test") ?? "").toLowerCase(),
        );
        let bodyTest = false;
        try {
          const body = (await request.json()) as { test?: unknown } | null;
          bodyTest = body?.test === true;
        } catch {
          /* empty or non-JSON body is fine */
        }

        try {
          const result = await runWeeklyFeedbackReport({ test: queryTest || bodyTest });
          if (result.status === "not_configured") {
            return json({ error: "Supabase server credentials not configured" }, 500);
          }
          return json(result);
        } catch (err) {
          console.error("send-weekly-feedback failed", err);
          return json({ error: String((err as Error)?.message ?? err) }, 500);
        }
      },
    },
  },
});
