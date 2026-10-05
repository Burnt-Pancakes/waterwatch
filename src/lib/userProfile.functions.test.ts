import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      inputValidator: () => ({ handler: (fn: unknown) => fn }),
      handler: (fn: unknown) => fn,
    }),
  }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: vi.fn(),
}));

type ChainResult = { data?: unknown; error?: { message: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order", "upsert", "delete", "insert"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (...args: unknown[]) =>
    Promise.resolve(result).then(
      args[0] as (v: ChainResult) => unknown,
      args[1] as ((r: unknown) => unknown) | undefined,
    );
  return chain;
}

const mockDeleteUser = vi.hoisted(() => vi.fn());
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { admin: { deleteUser: mockDeleteUser } },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: mockSupabase,
}));

import {
  getUserProfile,
  updateUserProfile,
  listUserAlerts,
  deleteUserAlertById,
  deleteUserAccount,
} from "./userProfile.functions";

type CtxHandler<O> = (args: { context: { userId: string } }) => Promise<O>;
type DataCtxHandler<I, O> = (args: { data: I; context: { userId: string } }) => Promise<O>;

const getProfileFn = getUserProfile as unknown as CtxHandler<unknown>;
const updateProfileFn = updateUserProfile as unknown as DataCtxHandler<
  { displayName?: string | null; emailAlertsEnabled?: boolean },
  { ok: true }
>;
const listAlertsFn = listUserAlerts as unknown as CtxHandler<unknown[]>;
const deleteAlertFn = deleteUserAlertById as unknown as DataCtxHandler<
  { alertId: string },
  { ok: true }
>;
const deleteAccountFn = deleteUserAccount as unknown as CtxHandler<{ ok: true }>;

const USER_ID = "user-uuid-1";
const ALERT_ID = "alert-uuid-1";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

// ── getUserProfile ─────────────────────────────────────────────────────────────
describe("getUserProfile", () => {
  it("returns the profile row when it exists", async () => {
    const profile = { id: USER_ID, display_name: "Alice", email_alerts_enabled: true };
    mockSupabase.from.mockReturnValue(makeChain({ data: profile }));

    const result = await getProfileFn({ context: { userId: USER_ID } });

    expect(result).toEqual(profile);
  });

  it("returns null when the profile row does not exist", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null }));

    const result = await getProfileFn({ context: { userId: USER_ID } });

    expect(result).toBeNull();
  });

  it("queries from('user_profiles')", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null }));

    await getProfileFn({ context: { userId: USER_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("user_profiles");
  });
});

// ── updateUserProfile ─────────────────────────────────────────────────────────
describe("updateUserProfile", () => {
  it("returns { ok: true } when upsert succeeds", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await updateProfileFn({
      data: { displayName: "Bob", emailAlertsEnabled: true },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: { message: "constraint violation" } }));

    await expect(
      updateProfileFn({
        data: { displayName: "Bob" },
        context: { userId: USER_ID },
      }),
    ).rejects.toThrow("constraint violation");
  });

  it("omits displayName from the patch when not provided", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    await updateProfileFn({
      data: { emailAlertsEnabled: false },
      context: { userId: USER_ID },
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("user_profiles");
  });

  it("omits emailAlertsEnabled from the patch when not provided", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await updateProfileFn({
      data: { displayName: null },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });
});

// ── listUserAlerts ────────────────────────────────────────────────────────────
describe("listUserAlerts", () => {
  it("returns mapped alert objects for active alerts", async () => {
    const alertRows = [
      {
        id: ALERT_ID,
        site_id: "site-1",
        trigger_on: ["unsafe"],
        is_active: true,
        sites: { name: "Four Mile Run", slug: "four-mile-run" },
      },
    ];
    mockSupabase.from.mockReturnValue(makeChain({ data: alertRows, error: null }));

    const result = await listAlertsFn({ context: { userId: USER_ID } });

    expect(result).toHaveLength(1);
    const item = (result as Array<Record<string, unknown>>)[0];
    expect(item.siteId).toBe("site-1");
    expect(item.siteName).toBe("Four Mile Run");
    expect(item.siteSlug).toBe("four-mile-run");
    expect(item.triggerOn).toEqual(["unsafe"]);
  });

  it("returns an empty array when there are no active alerts", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));

    const result = await listAlertsFn({ context: { userId: USER_ID } });

    expect(result).toEqual([]);
  });

  it("falls back to 'Unknown site' when sites relation is null", async () => {
    const alertRows = [
      {
        id: ALERT_ID,
        site_id: "site-x",
        trigger_on: ["caution"],
        is_active: true,
        sites: null,
      },
    ];
    mockSupabase.from.mockReturnValue(makeChain({ data: alertRows, error: null }));

    const result = await listAlertsFn({ context: { userId: USER_ID } });

    const item = (result as Array<Record<string, unknown>>)[0];
    expect(item.siteName).toBe("Unknown site");
    expect(item.siteSlug).toBe("");
  });

  it("throws when Supabase returns an error", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: { message: "timeout" } }));

    await expect(listAlertsFn({ context: { userId: USER_ID } })).rejects.toThrow("timeout");
  });
});

// ── deleteUserAlertById ───────────────────────────────────────────────────────
describe("deleteUserAlertById", () => {
  it("returns { ok: true } on successful deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await deleteAlertFn({
      data: { alertId: ALERT_ID },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: { message: "row locked" } }));

    await expect(
      deleteAlertFn({ data: { alertId: ALERT_ID }, context: { userId: USER_ID } }),
    ).rejects.toThrow("row locked");
  });

  it("calls from('alerts').delete()", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    await deleteAlertFn({ data: { alertId: ALERT_ID }, context: { userId: USER_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("alerts");
  });
});

// ── deleteUserAccount ─────────────────────────────────────────────────────────
describe("deleteUserAccount", () => {
  it("returns { ok: true } when auth deletion succeeds", async () => {
    mockDeleteUser.mockResolvedValue({ error: null });

    const result = await deleteAccountFn({ context: { userId: USER_ID } });

    expect(result).toEqual({ ok: true });
  });

  it("calls auth.admin.deleteUser with the user's id", async () => {
    mockDeleteUser.mockResolvedValue({ error: null });

    await deleteAccountFn({ context: { userId: USER_ID } });

    expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it("throws when the auth deletion returns an error", async () => {
    mockDeleteUser.mockResolvedValue({ error: { message: "user not found" } });

    await expect(deleteAccountFn({ context: { userId: USER_ID } })).rejects.toThrow(
      "user not found",
    );
  });
});
