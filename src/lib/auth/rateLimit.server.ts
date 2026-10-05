import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * IP-based attempt limiting for unauthenticated auth endpoints.
 *
 * Policy: max 5 attempts per IP per kind in any rolling 15-minute window.
 * Records and queries live in `public.auth_rate_limits` (service-role only).
 *
 * WHY in the database (not in-memory): TanStack server functions run on
 * stateless workers, so a Map<ip, count> would be reset on every cold
 * start and would not be shared across instances. The DB is the only
 * cross-request shared state we trust.
 */

export type RateLimitKind = "signin" | "signup" | "reset" | "magic_link";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

/**
 * Returns `{ allowed: false, retryAfterSeconds }` when the IP has hit the
 * cap for this `kind`, otherwise `{ allowed: true }`. Also records the
 * current attempt as a side effect on the allowed path so callers don't
 * have to remember a second call.
 */
export async function checkAndRecordAttempt(
  ip: string | null,
  kind: RateLimitKind,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  // Fall back to a sentinel so we still throttle obviously-spoofed clients
  // that don't expose a usable address.
  const ipKey = ip && ip.length > 0 ? ip : "unknown";
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const { count, error: countErr } = await supabaseAdmin
    .from("auth_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip", ipKey)
    .eq("kind", kind)
    .gte("attempted_at", since);

  if (countErr) {
    // Fail OPEN on infrastructure errors — we'd rather let a real user in
    // than lock the entire app out of sign-in if the table is briefly
    // unreachable. Log loud so this is visible in server logs.
    console.error("rate-limit count failed; failing open:", countErr);
    return { allowed: true };
  }

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: WINDOW_MINUTES * 60 };
  }

  // Record this attempt before we run the protected action. Counting
  // _attempts_ (not _failures_) is intentional — it caps total request
  // volume against the auth API regardless of outcome.
  const { error: insertErr } = await supabaseAdmin
    .from("auth_rate_limits")
    .insert({ ip: ipKey, kind });
  if (insertErr) console.error("rate-limit insert failed:", insertErr);

  // Cheap opportunistic cleanup so the table stays small. Errors ignored.
  if (Math.random() < 0.02) {
    void supabaseAdmin.rpc("purge_old_auth_rate_limits");
  }

  return { allowed: true };
}
