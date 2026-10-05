import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChainResult = { count?: number | null; error?: { message: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "gte", "insert"]) {
    chain[m] = () => chain;
  }
  chain.then = (...args: unknown[]) =>
    Promise.resolve(result).then(
      args[0] as (v: ChainResult) => unknown,
      args[1] as ((r: unknown) => unknown) | undefined,
    );
  return chain;
}

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: mockSupabase,
}));

import { checkAndRecordAttempt } from "./rateLimit.server";

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.rpc.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── allowed paths ─────────────────────────────────────────────────────────────
describe("checkAndRecordAttempt — allowed", () => {
  it("allows the attempt when the IP has fewer than 5 prior attempts", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 2, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    const result = await checkAndRecordAttempt("1.2.3.4", "signin");

    expect(result).toEqual({ allowed: true });
  });

  it("allows the attempt when the count is 0 (fresh IP)", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    const result = await checkAndRecordAttempt("10.0.0.1", "signup");

    expect(result).toEqual({ allowed: true });
  });

  it("allows and records attempt for each distinct kind", async () => {
    for (const kind of ["signup", "reset", "magic_link"] as const) {
      mockSupabase.from
        .mockReturnValueOnce(makeChain({ count: 1, error: null }))
        .mockReturnValueOnce(makeChain({ error: null }));

      const result = await checkAndRecordAttempt("1.2.3.4", kind);

      expect(result).toEqual({ allowed: true });
    }
  });

  it("queries from('auth_rate_limits') for count then for insert", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    await checkAndRecordAttempt("1.2.3.4", "signin");

    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    expect(mockSupabase.from).toHaveBeenCalledWith("auth_rate_limits");
  });
});

// ── blocked paths ─────────────────────────────────────────────────────────────
describe("checkAndRecordAttempt — blocked", () => {
  it("blocks when count equals MAX_ATTEMPTS (5)", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ count: 5, error: null }));

    const result = await checkAndRecordAttempt("1.2.3.4", "signup");

    expect(result).toMatchObject({ allowed: false, retryAfterSeconds: 900 });
  });

  it("blocks when count exceeds MAX_ATTEMPTS", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ count: 99, error: null }));

    const result = await checkAndRecordAttempt("9.9.9.9", "signin");

    expect(result).toMatchObject({ allowed: false });
  });

  it("does not call insert when blocked", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ count: 5, error: null }));

    await checkAndRecordAttempt("1.2.3.4", "signin");

    // Only one from() call for the count query — no insert call.
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });
});

// ── null / unknown IP ─────────────────────────────────────────────────────────
describe("checkAndRecordAttempt — null IP", () => {
  it("uses the 'unknown' sentinel when ip is null", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    const result = await checkAndRecordAttempt(null, "reset");

    expect(result).toEqual({ allowed: true });
    // Both from() calls should still happen — ip is just remapped to "unknown".
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it("uses the 'unknown' sentinel when ip is an empty string", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    const result = await checkAndRecordAttempt("", "signup");

    expect(result).toEqual({ allowed: true });
  });
});

// ── infrastructure error handling ─────────────────────────────────────────────
describe("checkAndRecordAttempt — fail-open on DB errors", () => {
  it("fails open (allowed: true) when the count query returns a DB error", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ count: null, error: { message: "connection refused" } }),
    );

    const result = await checkAndRecordAttempt("1.2.3.4", "signin");

    expect(result).toEqual({ allowed: true });
  });

  it("still returns allowed when the insert fails after a successful count", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 1, error: null }))
      .mockReturnValueOnce(makeChain({ error: { message: "write conflict" } }));

    const result = await checkAndRecordAttempt("1.2.3.4", "signup");

    expect(result).toEqual({ allowed: true });
  });
});

// ── opportunistic cleanup ─────────────────────────────────────────────────────
describe("checkAndRecordAttempt — opportunistic purge", () => {
  it("calls rpc purge_old_auth_rate_limits when Math.random < 0.02", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    await checkAndRecordAttempt("1.2.3.4", "signin");

    expect(mockSupabase.rpc).toHaveBeenCalledWith("purge_old_auth_rate_limits");

    randomSpy.mockRestore();
  });

  it("does not call rpc purge when Math.random >= 0.02", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeChain({ error: null }));

    await checkAndRecordAttempt("1.2.3.4", "signin");

    expect(mockSupabase.rpc).not.toHaveBeenCalled();

    randomSpy.mockRestore();
  });
});
