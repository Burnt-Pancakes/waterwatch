import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkAndRecordAttempt } from "./auth/rateLimit.server";
import { passwordSchema, emailSchema } from "./auth/passwordValidation";

/**
 * Unauthenticated Supabase client built per-request from the publishable
 * key. We don't reuse the long-lived `supabase` browser singleton on the
 * server because (a) it persists sessions to localStorage which doesn't
 * exist in the Worker runtime, and (b) we want each request's auth call
 * to be statelessly isolated.
 */
function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Caller IP — prefer Cloudflare's CF-Connecting-IP (set by the edge,
 * not spoofable by clients) and only fall back to X-Forwarded-For /
 * X-Real-IP when CF-Connecting-IP is absent.
 */
function callerIp(): string | null {
  try {
    const req = getRequest();
    const cf = req.headers.get("cf-connecting-ip");
    if (cf) return cf;
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    return req.headers.get("x-real-ip");
  } catch {
    return null;
  }
}

const SITE_URL_FALLBACK = "http://localhost:8080";
/**
 * Auth-email redirect origin. Derived ONLY from the server-side SITE_URL
 * env var — never from client input — so an attacker cannot point
 * verification / reset emails at an arbitrary domain.
 */
function siteOrigin(): string {
  return process.env.SITE_URL ?? SITE_URL_FALLBACK;
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Create a new user account.
 *
 * Flow:
 *  1. Per-IP rate limit (5 / 15 min) — enforced before touching Supabase.
 *  2. Server-side password + email validation (defense in depth — the
 *     client form already validates).
 *  3. `supabase.auth.signUp` with `emailRedirectTo` pointing at the
 *     verify-email route. Supabase queues a verification email; once
 *     Lovable Emails is wired the auth-email-hook will brand it.
 *
 * Returns `{ ok: true }` on success. On failure throws so the client can
 * show the message — never returns a session (signup requires email
 * confirmation per project policy: auto-confirm is OFF).
 */
export const signUpUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signUpSchema.parse(input))
  .handler(async ({ data }) => {
    const rl = await checkAndRecordAttempt(callerIp(), "signup");
    if (!rl.allowed) {
      throw new Error(
        `Too many sign-up attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`,
      );
    }

    const supabase = publicClient();
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${siteOrigin()}/auth/verify-email`,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, email: data.email };
  });

// ---------------------------------------------------------------------------
// Sign-in (password)
// ---------------------------------------------------------------------------

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(200),
});

/**
 * Sign in with email + password.
 *
 * The server performs the auth call so we can apply the per-IP rate
 * limit BEFORE Supabase's own throttle. The returned `access_token` /
 * `refresh_token` pair is handed back to the client, which calls
 * `supabase.auth.setSession(...)` to persist the session in
 * localStorage. This keeps the client-side session APIs working
 * unchanged while the throttle stays on the server.
 */
export const signInWithPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signInSchema.parse(input))
  .handler(async ({ data }) => {
    const rl = await checkAndRecordAttempt(callerIp(), "signin");
    if (!rl.allowed) {
      throw new Error(
        `Too many sign-in attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`,
      );
    }

    const supabase = publicClient();
    const { data: result, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error || !result.session) {
      // Use a generic message — don't leak whether email exists.
      throw new Error("Invalid email or password.");
    }
    return {
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    };
  });

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

const magicLinkSchema = z.object({
  email: emailSchema,
});

/**
 * Send a passwordless sign-in link. Same rate-limit bucket separation as
 * the other flows so brute-force probing one flow doesn't burn the others.
 */
export const sendMagicLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => magicLinkSchema.parse(input))
  .handler(async ({ data }) => {
    const rl = await checkAndRecordAttempt(callerIp(), "magic_link");
    if (!rl.allowed) {
      throw new Error(
        `Too many requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`,
      );
    }
    const supabase = publicClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: data.email,
      options: {
        emailRedirectTo: `${siteOrigin()}/auth/callback`,
        shouldCreateUser: false, // magic link should not silently provision accounts
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const resetSchema = z.object({
  email: emailSchema,
});

/**
 * Request a password-reset email. Always returns `ok: true` (never reveals
 * whether the email exists) — Supabase handles the actual send.
 */
export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => resetSchema.parse(input))
  .handler(async ({ data }) => {
    const rl = await checkAndRecordAttempt(callerIp(), "reset");
    if (!rl.allowed) {
      throw new Error(
        `Too many reset requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`,
      );
    }
    const supabase = publicClient();
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${siteOrigin()}/auth/update-password`,
    });
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Current user — protected
// ---------------------------------------------------------------------------

/**
 * Returns the authenticated user's id + email + display profile, or
 * throws via `requireSupabaseAuth` when no valid bearer is attached.
 *
 * Used by protected route loaders / layouts to enforce server-side auth
 * (never rely on client-only guards for sensitive data).
 */
export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Re-validate with the Auth server (don't trust the token blindly).
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) throw new Error("Unauthenticated");

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id, display_name, email_alerts_enabled")
      .eq("id", userId)
      .maybeSingle();

    return {
      id: userRes.user.id,
      email: userRes.user.email ?? null,
      profile: profile ?? null,
    };
  });
