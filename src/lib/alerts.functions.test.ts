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
  for (const m of [
    "select",
    "eq",
    "neq",
    "in",
    "gte",
    "order",
    "limit",
    "delete",
    "upsert",
    "insert",
    "update",
  ]) {
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

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: mockSupabase,
}));

import {
  getAlertConfig,
  upsertAlertConfig,
  deleteAlertConfig,
  listMyAlerts,
  toggleAlertActive,
  deleteAlertById,
} from "./alerts.functions";

type Handler<I, O> = (args: { data: I; context: { userId: string } }) => Promise<O>;
type NoInputHandler<O> = (args: { context: { userId: string } }) => Promise<O>;

const getHandler = getAlertConfig as unknown as Handler<{ siteId: string }, unknown>;
const upsertHandler = upsertAlertConfig as unknown as Handler<
  { siteId: string; triggerOn: string[]; isActive?: boolean },
  unknown
>;
const deleteHandler = deleteAlertConfig as unknown as Handler<{ siteId: string }, { ok: true }>;
const listHandler = listMyAlerts as unknown as NoInputHandler<unknown[]>;
const toggleHandler = toggleAlertActive as unknown as Handler<
  { alertId: string; isActive: boolean },
  { ok: true }
>;
const deleteByIdHandler = deleteAlertById as unknown as Handler<{ alertId: string }, { ok: true }>;

const USER_ID = "user-uuid-1";
const SITE_ID = "site-uuid-1";
const ALERT_ID = "alert-uuid-1";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

// ── getAlertConfig ────────────────────────────────────────────────────────────
describe("getAlertConfig", () => {
  it("returns the alert row when one exists for the user+site", async () => {
    const alertRow = {
      id: "alert-1",
      site_id: SITE_ID,
      trigger_on: ["caution", "unsafe"],
      is_active: true,
    };
    mockSupabase.from.mockReturnValue(makeChain({ data: alertRow }));

    const result = await getHandler({ data: { siteId: SITE_ID }, context: { userId: USER_ID } });

    expect(result).toEqual(alertRow);
  });

  it("returns null when no alert exists for the user+site", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null }));

    const result = await getHandler({ data: { siteId: SITE_ID }, context: { userId: USER_ID } });

    expect(result).toBeNull();
  });

  it("queries the alerts table with correct user_id and site_id", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null }));

    await getHandler({ data: { siteId: SITE_ID }, context: { userId: USER_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("alerts");
  });
});

// ── upsertAlertConfig ─────────────────────────────────────────────────────────
describe("upsertAlertConfig", () => {
  it("returns the upserted alert row on success", async () => {
    const upserted = { id: "alert-2", site_id: SITE_ID, trigger_on: ["pass"], is_active: true };
    mockSupabase.from.mockReturnValue(makeChain({ data: upserted, error: null }));

    const result = await upsertHandler({
      data: { siteId: SITE_ID, triggerOn: ["pass"] },
      context: { userId: USER_ID },
    });

    expect(result).toEqual(upserted);
  });

  it("throws when Supabase returns an error during upsert", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ data: null, error: { message: "Unique constraint violation" } }),
    );

    await expect(
      upsertHandler({
        data: { siteId: SITE_ID, triggerOn: ["caution"] },
        context: { userId: USER_ID },
      }),
    ).rejects.toThrow("Unique constraint violation");
  });

  it("allows weather_advisory alongside water quality triggers", async () => {
    const triggers = ["caution", "unsafe", "weather_advisory"];
    const upserted = { id: "alert-4", site_id: SITE_ID, trigger_on: triggers, is_active: true };
    mockSupabase.from.mockReturnValue(makeChain({ data: upserted, error: null }));

    const result = await upsertHandler({
      data: { siteId: SITE_ID, triggerOn: triggers },
      context: { userId: USER_ID },
    });

    expect((result as Record<string, unknown>)?.trigger_on).toEqual(triggers);
  });

  it("allows multiple trigger conditions in one config", async () => {
    const triggers = ["caution", "unsafe", "pass"];
    const upserted = { id: "alert-3", site_id: SITE_ID, trigger_on: triggers, is_active: true };
    mockSupabase.from.mockReturnValue(makeChain({ data: upserted, error: null }));

    const result = await upsertHandler({
      data: { siteId: SITE_ID, triggerOn: triggers },
      context: { userId: USER_ID },
    });

    expect((result as Record<string, unknown>)?.trigger_on).toEqual(triggers);
  });
});

// ── deleteAlertConfig ─────────────────────────────────────────────────────────
describe("deleteAlertConfig", () => {
  it("returns { ok: true } on successful deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await deleteHandler({
      data: { siteId: SITE_ID },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error during deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: { message: "Row locked" } }));

    await expect(
      deleteHandler({ data: { siteId: SITE_ID }, context: { userId: USER_ID } }),
    ).rejects.toThrow("Row locked");
  });

  it("calls from('alerts').delete()", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    await deleteHandler({ data: { siteId: SITE_ID }, context: { userId: USER_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("alerts");
  });
});

// ── listMyAlerts ──────────────────────────────────────────────────────────────
describe("listMyAlerts", () => {
  it("maps alert rows with joined site data into the expected shape", async () => {
    const rows = [
      {
        id: ALERT_ID,
        site_id: SITE_ID,
        trigger_on: ["caution", "unsafe"],
        is_active: true,
        created_at: "2026-06-01T00:00:00.000Z",
        sites: { name: "Sandy Point", slug: "sandy-point" },
      },
    ];
    mockSupabase.from.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await listHandler({ context: { userId: USER_ID } });

    expect(result).toEqual([
      {
        id: ALERT_ID,
        siteId: SITE_ID,
        siteName: "Sandy Point",
        siteSlug: "sandy-point",
        triggerOn: ["caution", "unsafe"],
        isActive: true,
      },
    ]);
  });

  it("falls back to 'Unknown site' when the joined site is null", async () => {
    const rows = [
      {
        id: ALERT_ID,
        site_id: SITE_ID,
        trigger_on: ["pass"],
        is_active: false,
        created_at: "2026-06-01T00:00:00.000Z",
        sites: null,
      },
    ];
    mockSupabase.from.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await listHandler({ context: { userId: USER_ID } });

    expect((result as Array<Record<string, unknown>>)[0]).toMatchObject({
      siteName: "Unknown site",
      siteSlug: "",
    });
  });

  it("returns an empty array when the user has no alerts", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await listHandler({ context: { userId: USER_ID } });

    expect(result).toEqual([]);
  });

  it("throws when Supabase returns an error while listing", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ data: null, error: { message: "Query failed" } }),
    );

    await expect(listHandler({ context: { userId: USER_ID } })).rejects.toThrow("Query failed");
  });
});

// ── toggleAlertActive ─────────────────────────────────────────────────────────
describe("toggleAlertActive", () => {
  it("returns { ok: true } on successful toggle", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await toggleHandler({
      data: { alertId: ALERT_ID, isActive: false },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error during toggle", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: { message: "Row not found" } }));

    await expect(
      toggleHandler({ data: { alertId: ALERT_ID, isActive: true }, context: { userId: USER_ID } }),
    ).rejects.toThrow("Row not found");
  });

  it("calls from('alerts').update() scoped to the alert and user", async () => {
    const chain = makeChain({ error: null });
    mockSupabase.from.mockReturnValue(chain);

    await toggleHandler({
      data: { alertId: ALERT_ID, isActive: true },
      context: { userId: USER_ID },
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("alerts");
  });
});

// ── deleteAlertById ───────────────────────────────────────────────────────────
describe("deleteAlertById", () => {
  it("returns { ok: true } on successful deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await deleteByIdHandler({
      data: { alertId: ALERT_ID },
      context: { userId: USER_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error during deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: { message: "Row locked" } }));

    await expect(
      deleteByIdHandler({ data: { alertId: ALERT_ID }, context: { userId: USER_ID } }),
    ).rejects.toThrow("Row locked");
  });

  it("calls from('alerts').delete() scoped to the alert and user", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    await deleteByIdHandler({ data: { alertId: ALERT_ID }, context: { userId: USER_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("alerts");
  });
});
