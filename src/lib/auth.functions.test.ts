import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: unknown) => fn }),
    middleware: () => ({ handler: (fn: unknown) => fn }),
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestIP: vi.fn().mockReturnValue("127.0.0.1"),
}));

const mockCheckAndRecordAttempt = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/rateLimit.server", () => ({
  checkAndRecordAttempt: mockCheckAndRecordAttempt,
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: vi.fn(),
}));

const mockAuth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: mockAuth }),
}));

import {
  signUpUser,
  signInWithPassword,
  sendMagicLink,
  sendPasswordReset,
  getCurrentUser,
} from "./auth.functions";

type AnyFn = (args: Record<string, unknown>) => Promise<unknown>;

const signUpFn = signUpUser as unknown as AnyFn;
const signInFn = signInWithPassword as unknown as AnyFn;
const magicLinkFn = sendMagicLink as unknown as AnyFn;
const resetFn = sendPasswordReset as unknown as AnyFn;
const currentUserFn = getCurrentUser as unknown as AnyFn;

const EMAIL = "user@example.com";
const PASSWORD = "Str0ng!Pass#9";

function makeContextSupabase(
  getUserResult: { data: { user: unknown }; error: unknown },
  profileResult: { data: unknown },
) {
  const fromChain = {
    select: function () {
      return this as typeof fromChain;
    },
    eq: function () {
      return this as typeof fromChain;
    },
    maybeSingle: () => Promise.resolve(profileResult),
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue(getUserResult) },
    from: vi.fn().mockReturnValue(fromChain),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-anon-key";
  mockCheckAndRecordAttempt.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SITE_URL;
});

// ── signUpUser ────────────────────────────────────────────────────────────────
describe("signUpUser", () => {
  it("returns { ok: true, email } on successful sign-up", async () => {
    mockAuth.signUp.mockResolvedValue({ error: null });

    const result = await signUpFn({ data: { email: EMAIL, password: PASSWORD } });

    expect(result).toEqual({ ok: true, email: EMAIL });
  });

  it("throws when the IP is rate-limited", async () => {
    mockCheckAndRecordAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    await expect(signUpFn({ data: { email: EMAIL, password: PASSWORD } })).rejects.toThrow(
      "Too many sign-up attempts",
    );
  });

  it("throws when Supabase returns an error", async () => {
    mockAuth.signUp.mockResolvedValue({ error: { message: "Email already registered" } });

    await expect(signUpFn({ data: { email: EMAIL, password: PASSWORD } })).rejects.toThrow(
      "Email already registered",
    );
  });

  it("uses the SITE_URL env when no origin is provided", async () => {
    process.env.SITE_URL = "https://app.watervoice.io";
    mockAuth.signUp.mockResolvedValue({ error: null });

    await signUpFn({ data: { email: EMAIL, password: PASSWORD } });

    const arg = mockAuth.signUp.mock.calls[0][0] as {
      options: { emailRedirectTo: string };
    };
    expect(arg.options.emailRedirectTo).toContain("https://app.watervoice.io");
  });

  it("falls back to the localhost sentinel when no env or origin is set", async () => {
    delete process.env.SITE_URL;
    mockAuth.signUp.mockResolvedValue({ error: null });

    await signUpFn({ data: { email: EMAIL, password: PASSWORD } });

    const arg = mockAuth.signUp.mock.calls[0][0] as {
      options: { emailRedirectTo: string };
    };
    expect(arg.options.emailRedirectTo).toContain("localhost");
  });
});

// ── signInWithPassword ────────────────────────────────────────────────────────
describe("signInWithPassword", () => {
  it("returns access_token and refresh_token on successful sign-in", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: "tok-a", refresh_token: "tok-r" } },
      error: null,
    });

    const result = await signInFn({ data: { email: EMAIL, password: PASSWORD } });

    expect(result).toEqual({ access_token: "tok-a", refresh_token: "tok-r" });
  });

  it("throws a generic message on Supabase auth error", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    await expect(signInFn({ data: { email: EMAIL, password: PASSWORD } })).rejects.toThrow(
      "Invalid email or password.",
    );
  });

  it("throws a generic message when the session is null with no error", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    await expect(signInFn({ data: { email: EMAIL, password: PASSWORD } })).rejects.toThrow(
      "Invalid email or password.",
    );
  });

  it("throws when rate-limited", async () => {
    mockCheckAndRecordAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    await expect(signInFn({ data: { email: EMAIL, password: PASSWORD } })).rejects.toThrow(
      "Too many sign-in attempts",
    );
  });
});

// ── sendMagicLink ─────────────────────────────────────────────────────────────
describe("sendMagicLink", () => {
  it("returns { ok: true } on success", async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });

    const result = await magicLinkFn({ data: { email: EMAIL } });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error", async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: { message: "User not found" } });

    await expect(magicLinkFn({ data: { email: EMAIL } })).rejects.toThrow("User not found");
  });

  it("throws when rate-limited", async () => {
    mockCheckAndRecordAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    await expect(magicLinkFn({ data: { email: EMAIL } })).rejects.toThrow("Too many requests");
  });

  it("passes shouldCreateUser: false to prevent silent account creation", async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });

    await magicLinkFn({ data: { email: EMAIL } });

    const arg = mockAuth.signInWithOtp.mock.calls[0][0] as {
      options: { shouldCreateUser: boolean };
    };
    expect(arg.options.shouldCreateUser).toBe(false);
  });
});

// ── sendPasswordReset ─────────────────────────────────────────────────────────
describe("sendPasswordReset", () => {
  it("returns { ok: true } even when the email does not exist", async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({ error: null });

    const result = await resetFn({ data: { email: EMAIL } });

    expect(result).toEqual({ ok: true });
  });

  it("throws when rate-limited", async () => {
    mockCheckAndRecordAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    await expect(resetFn({ data: { email: EMAIL } })).rejects.toThrow("Too many reset requests");
  });

  it("always calls resetPasswordForEmail when allowed", async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({ error: null });

    await resetFn({ data: { email: EMAIL } });

    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledOnce();
    expect(mockAuth.resetPasswordForEmail.mock.calls[0][0]).toBe(EMAIL);
  });
});

// ── getCurrentUser ────────────────────────────────────────────────────────────
describe("getCurrentUser", () => {
  it("returns id, email and profile when auth succeeds", async () => {
    const ctx = makeContextSupabase(
      { data: { user: { id: "user-1", email: "alice@example.com" } }, error: null },
      { data: { id: "user-1", display_name: "Alice", email_alerts_enabled: true } },
    );

    const result = await currentUserFn({ context: { supabase: ctx, userId: "user-1" } });

    const r = result as Record<string, unknown>;
    expect(r.id).toBe("user-1");
    expect(r.email).toBe("alice@example.com");
    expect((r.profile as Record<string, unknown>).display_name).toBe("Alice");
  });

  it("throws Unauthenticated when getUser returns an error", async () => {
    const ctx = makeContextSupabase(
      { data: { user: null }, error: { message: "invalid token" } },
      { data: null },
    );

    await expect(currentUserFn({ context: { supabase: ctx, userId: "" } })).rejects.toThrow(
      "Unauthenticated",
    );
  });

  it("throws Unauthenticated when user is null with no error", async () => {
    const ctx = makeContextSupabase({ data: { user: null }, error: null }, { data: null });

    await expect(currentUserFn({ context: { supabase: ctx, userId: "" } })).rejects.toThrow(
      "Unauthenticated",
    );
  });

  it("returns profile: null when the profile row does not exist", async () => {
    const ctx = makeContextSupabase(
      { data: { user: { id: "user-2", email: "bob@example.com" } }, error: null },
      { data: null },
    );

    const result = await currentUserFn({ context: { supabase: ctx, userId: "user-2" } });

    expect((result as Record<string, unknown>).profile).toBeNull();
  });
});
