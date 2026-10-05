import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the TanStack Start server-function runtime ──────────────────────────
// Each server function is created via:
//   createServerFn().middleware([]).handler(fn)          (getFavoritesWithStatus)
//   createServerFn().middleware([]).inputValidator().handler(fn)  (removeFavorite)
// The mock makes the final .handler(fn) return fn directly so tests can call
// the exported symbol as a plain async function.
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

// ── Flexible Supabase query-builder factory ───────────────────────────────────
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

// Import AFTER mocks are declared.
import { getFavoritesWithStatus, removeFavorite } from "./favorites.functions";

type Handler<T> = (args: { data?: unknown; context: { userId: string } }) => Promise<T>;

const getHandler = getFavoritesWithStatus as unknown as Handler<unknown[]>;
const removeHandler = removeFavorite as unknown as Handler<{ ok: true }>;

const MOCK_USER = "user-uuid-1";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

// ── getFavoritesWithStatus ────────────────────────────────────────────────────
describe("getFavoritesWithStatus", () => {
  it("returns an empty array when user has no favorites", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });
    expect(result).toEqual([]);
  });

  it("throws when favorites query returns an error", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ data: null, error: { message: "DB connection lost" } }),
    );

    await expect(getHandler({ context: { userId: MOCK_USER } })).rejects.toThrow(
      "DB connection lost",
    );
  });

  it("maps a favorite with a fresh reading to a FavoriteWithStatus entry", async () => {
    const now = new Date().toISOString();
    const favData = [
      {
        id: "fav-1",
        site_id: "site-1",
        sites: {
          id: "site-1",
          name: "Four Mile Run Kayak Launch",
          slug: "four-mile-run",
          site_type: "kayak_launch",
          water_body_type: "freshwater",
          lat: 38.85,
          lng: -77.07,
        },
      },
    ];
    const readingsData = [
      {
        site_id: "site-1",
        sampled_at: now,
        e_coli_mpn: 100,
        enterococci_cce: null,
      },
    ];

    // First from("favorites") call returns favorites, second from("readings") returns readings.
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: favData, error: null }))
      .mockReturnValueOnce(makeChain({ data: readingsData, error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });

    expect(result).toHaveLength(1);
    const item = (result as Array<Record<string, unknown>>)[0];
    expect(item.favoriteId).toBe("fav-1");
    expect(item.siteId).toBe("site-1");
    expect(item.siteName).toBe("Four Mile Run Kayak Launch");
    expect(item.siteSlug).toBe("four-mile-run");
    expect(item.siteType).toBe("kayak_launch");
    expect(item.status).toBe("pass"); // 100 MPN < 235 threshold
    expect(item.eColiMpn).toBe(100);
    expect(item.lat).toBe(38.85);
    expect(item.lng).toBe(-77.07);
  });

  it("assigns no_data status when no reading exists for a site", async () => {
    const favData = [
      {
        id: "fav-2",
        site_id: "site-2",
        sites: {
          id: "site-2",
          name: "Gravelly Point",
          slug: "gravelly-point",
          site_type: "boat_ramp",
          water_body_type: "tidal_brackish",
          lat: 38.86,
          lng: -77.06,
        },
      },
    ];

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: favData, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });

    expect((result as Array<Record<string, unknown>>)[0].status).toBe("no_data");
    expect((result as Array<Record<string, unknown>>)[0].sampledAt).toBeNull();
  });

  it("marks the entry as stale when the reading is older than the threshold", async () => {
    // Sampled 10 days ago — well above the STALE_THRESHOLD_DAYS (3 days).
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const favData = [
      {
        id: "fav-3",
        site_id: "site-3",
        sites: {
          id: "site-3",
          name: "Old Site",
          slug: "old-site",
          site_type: "kayak_launch",
          water_body_type: "freshwater",
          lat: 38.9,
          lng: -77.1,
        },
      },
    ];
    const readingsData = [
      {
        site_id: "site-3",
        sampled_at: tenDaysAgo,
        e_coli_mpn: 50,
        enterococci_cce: null,
      },
    ];

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: favData, error: null }))
      .mockReturnValueOnce(makeChain({ data: readingsData, error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });

    expect((result as Array<Record<string, unknown>>)[0].stale).toBe(true);
  });

  it("skips favorites where sites relation is null", async () => {
    const favData = [{ id: "fav-x", site_id: "site-x", sites: null }];

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: favData, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });
    expect(result).toEqual([]);
  });

  it("sorts results so unsafe sites appear first", async () => {
    const now = new Date().toISOString();
    const favData = [
      {
        id: "fav-pass",
        site_id: "site-pass",
        sites: {
          id: "site-pass",
          name: "Safe Site",
          slug: "safe",
          site_type: "kayak_launch",
          water_body_type: "freshwater",
          lat: 38.9,
          lng: -77.0,
        },
      },
      {
        id: "fav-unsafe",
        site_id: "site-unsafe",
        sites: {
          id: "site-unsafe",
          name: "Unsafe Site",
          slug: "unsafe",
          site_type: "kayak_launch",
          water_body_type: "freshwater",
          lat: 38.9,
          lng: -77.0,
        },
      },
    ];
    const readingsData = [
      { site_id: "site-pass", sampled_at: now, e_coli_mpn: 100, enterococci_cce: null },
      { site_id: "site-unsafe", sampled_at: now, e_coli_mpn: 999, enterococci_cce: null },
    ];

    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: favData, error: null }))
      .mockReturnValueOnce(makeChain({ data: readingsData, error: null }));

    const result = await getHandler({ context: { userId: MOCK_USER } });
    const statuses = (result as Array<Record<string, unknown>>).map((r) => r.status);
    expect(statuses[0]).toBe("unsafe");
    expect(statuses[1]).toBe("pass");
  });
});

// ── removeFavorite ────────────────────────────────────────────────────────────
describe("removeFavorite", () => {
  it("returns { ok: true } on successful deletion", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await removeHandler({
      data: { favoriteId: "fav-id-to-delete" },
      context: { userId: MOCK_USER },
    });

    expect(result).toEqual({ ok: true });
  });

  it("throws when Supabase returns an error during deletion", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ data: null, error: { message: "Row not found" } }),
    );

    await expect(
      removeHandler({
        data: { favoriteId: "fav-missing" },
        context: { userId: MOCK_USER },
      }),
    ).rejects.toThrow("Row not found");
  });

  it("calls from('favorites').delete()", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    await removeHandler({
      data: { favoriteId: "fav-1" },
      context: { userId: MOCK_USER },
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("favorites");
  });
});
