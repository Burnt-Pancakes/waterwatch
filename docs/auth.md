# Authentication

WaterVoice DMV uses Supabase Auth (email/password + magic link). The map is fully public — no auth is required to view water quality data. Auth gates only: favorites, alerts, account management.

---

## Overview

Auth operations are implemented as **TanStack Start server functions** in `src/lib/auth.functions.ts`. All sensitive operations (sign-up, sign-in, magic link, password reset) run on the server so:

1. Per-IP rate limiting is applied before calling Supabase.
2. The service-role Supabase client is never exposed to the client bundle.
3. Redirect URLs are controlled by the server-side `SITE_URL` env var — attackers cannot point auth emails at an arbitrary domain.

---

## Server Functions

All functions use a per-request `publicClient()` — a stateless Supabase client built from `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` with `persistSession: false`.

### `signUpUser`

```typescript
export const signUpUser = createServerFn({ method: "POST" })
```

**Input:** `{ email: string, password: string }`

**Flow:**
1. Per-IP rate limit: 5 attempts / 15 minutes on the `signup` bucket.
2. Server-side Zod validation of email and password.
3. `supabase.auth.signUp` with `emailRedirectTo: siteOrigin() + "/auth/verify-email"`.
4. Email confirmation is required (`auto-confirm` is OFF).

**Returns:** `{ ok: true, email: string }` on success. Throws on failure.

Auto-confirm is off — the user must click the link in the verification email before they can sign in.

---

### `signInWithPassword`

```typescript
export const signInWithPassword = createServerFn({ method: "POST" })
```

**Input:** `{ email: string, password: string }`

**Flow:**
1. Per-IP rate limit: 5 attempts / 15 minutes on the `signin` bucket.
2. `supabase.auth.signInWithPassword`.
3. On success, returns `{ access_token, refresh_token }` to the client.
4. The client calls `supabase.auth.setSession(...)` to persist the session in `localStorage`.

Error messages are generic ("Invalid email or password") — the server never reveals whether the email exists.

---

### `sendMagicLink`

```typescript
export const sendMagicLink = createServerFn({ method: "POST" })
```

**Input:** `{ email: string }`

**Flow:**
1. Rate limit on the `magic_link` bucket.
2. `supabase.auth.signInWithOtp` with `shouldCreateUser: false` (magic links do not silently provision accounts).
3. Redirect: `siteOrigin() + "/auth/callback"`.

---

### `sendPasswordReset`

```typescript
export const sendPasswordReset = createServerFn({ method: "POST" })
```

**Input:** `{ email: string }`

**Flow:**
1. Rate limit on the `reset` bucket.
2. `supabase.auth.resetPasswordForEmail` with `redirectTo: siteOrigin() + "/auth/update-password"`.
3. Always returns `{ ok: true }` — never reveals whether the email exists.

---

### `getCurrentUser`

```typescript
export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
```

**Protected route:** Requires a valid bearer token (enforced by `requireSupabaseAuth` middleware).

**Returns:** `{ id, email, profile: { id, display_name, email_alerts_enabled } | null }`

Re-validates the token with the Supabase Auth server on every call — does not trust the JWT blindly.

---

## Rate Limiting

**File:** `src/lib/auth/rateLimit.server.ts`

**Function:** `checkAndRecordAttempt(ip, kind)`

**Policy:** 5 attempts per IP per `kind` in any rolling 15-minute window.

**Implementation:**
- Counts rows in `auth_rate_limits` for the given `(ip, kind)` within the last 15 minutes.
- If count >= 5, returns `{ allowed: false, retryAfterSeconds: 900 }`.
- On the allowed path, inserts a new row before the protected action runs. This counts attempts (not failures), capping total request volume regardless of outcome.
- Fails OPEN on DB infrastructure errors — a brief table outage will not lock users out of the app. Errors are logged loudly.
- Opportunistic cleanup (2% probability per request): calls `purge_old_auth_rate_limits()` to delete rows older than 24 hours.

IP detection priority: `CF-Connecting-IP` (set by Cloudflare edge, not spoofable) > `X-Forwarded-For` (first hop) > `X-Real-IP`. Unknown IPs use the sentinel `"unknown"` — still rate-limited.

---

## Password Policy

**File:** `src/lib/auth/passwordValidation.ts`

Defined as a single Zod schema imported by both the client form (instant feedback) and the `signUpUser` server function (trusted gate). Drift between client and server validation is not possible.

**Rules:**
- Minimum 8 characters
- At least one uppercase letter
- At least one digit

**Exported helpers:**
- `passwordSchema` — Zod schema
- `validatePassword(input)` — returns the first failing message, or `null` when valid
- `isStrongPassword(input)` — boolean convenience wrapper
- `emailSchema` — trimmed, lowercased, validated email, max 255 chars

---

## Auth Routes

| Route | Purpose |
|---|---|
| `/auth/sign-in` | Email/password login form |
| `/auth/sign-up` | Account creation form |
| `/auth/verify-email` | Prompt after sign-up ("check your email") |
| `/auth/callback` | OAuth / magic link callback handler |
| `/auth/reset-password` | Request password reset email |
| `/auth/update-password` | Set new password (arrives from reset link) |

---

## Session Management

When `supabase.auth.onAuthStateChange` fires (sign-in or sign-out), the root layout (`__root.tsx`) calls `router.invalidate()` and `qc.invalidateQueries()` so all user-scoped data is refreshed and cached queries for previous sessions are not leaked to the new session.

---

## New User Profile

When a new user is created in `auth.users`, the `handle_new_user` trigger automatically inserts a `user_profiles` row with `display_name` from `raw_user_meta_data`. The trigger runs `SECURITY DEFINER` and uses `ON CONFLICT (id) DO NOTHING` to handle replay-safe behavior.
