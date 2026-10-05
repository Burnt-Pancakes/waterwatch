import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: unknown) => fn }),
  }),
}));

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: mockSupabase,
}));

type ChainResult = { data: unknown; error?: { message: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "not", "order", "limit"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (...args: unknown[]) =>
    Promise.resolve(result).then(
      args[0] as (v: ChainResult) => unknown,
      args[1] as ((r: unknown) => unknown) | undefined,
    );
  return chain;
}

import { getSiteDetails, getSiteDetailsBySlug } from "./siteDetails.functions";

type Handler<I, O> = (args: { data: I }) => Promise<O>;
const getDetailsHandler = getSiteDetails as unknown as Handler<{ siteId: string }, unknown>;
const getBySlugHandler = getSiteDetailsBySlug as unknown as Handler<{ slug: string }, unknown>;

const SITE_ID = "11111111-1111-1111-1111-111111111111";

const SITE_DATA = {
  id: SITE_ID,
  slug: "four-mile-run",
  name: "Four Mile Run",
  site_type: "kayak_launch",
  water_body_type: "freshwater",
  lat: 38.85,
  lng: -77.07,
  address: "123 River Rd",
  description: "Nice kayak spot",
  amenities: ["parking"],
  parking_notes: "Free",
  ada_accessible: true,
  data_source_ids: ["usgs"],
};

const now = new Date().toISOString();

const FRESH_READING = {
  id: "read-1",
  sampled_at: now,
  e_coli_mpn: 100,
  enterococci_cce: null,
  sample_method: "IDEXX",
  data_source: "usgs",
  source_url: null,
  status: "pass",
};

function setupGetDetails(siteResult: ChainResult, readingsData: unknown[], rainData: unknown[]) {
  mockSupabase.from
    .mockReturnValueOnce(makeChain(siteResult))
    .mockReturnValueOnce(makeChain({ data: readingsData }))
    .mockReturnValueOnce(makeChain({ data: rainData }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

// ── getSiteDetails ─────────────────────────────────────────────────────────────
describe("getSiteDetails", () => {
  it("returns site data, pass status, and stale: false for a fresh reading", async () => {
    setupGetDetails({ data: SITE_DATA }, [FRESH_READING], []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.site).toMatchObject({ id: SITE_ID, name: "Four Mile Run" });
    expect(r.status).toBe("pass");
    expect(r.stale).toBe(false);
    expect(r.advisoryActive).toBe(false);
    expect(r.latest).toMatchObject({ id: "read-1" });
  });

  it("throws 'Site not found' when the sites query returns null", async () => {
    setupGetDetails({ data: null }, [], []);

    await expect(getDetailsHandler({ data: { siteId: SITE_ID } })).rejects.toThrow(
      "Site not found",
    );
  });

  it("throws the Supabase error message when the sites query fails", async () => {
    setupGetDetails({ data: null, error: { message: "relation not found" } }, [], []);

    await expect(getDetailsHandler({ data: { siteId: SITE_ID } })).rejects.toThrow(
      "relation not found",
    );
  });

  it("returns no_data status and null latest when readings array is empty", async () => {
    setupGetDetails({ data: SITE_DATA }, [], []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.status).toBe("no_data");
    expect(r.latest).toBeNull();
    expect(r.geometricMean).toBeNull();
  });

  it("marks stale when the latest reading is older than the stale threshold", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    setupGetDetails({ data: SITE_DATA }, [{ ...FRESH_READING, sampled_at: tenDaysAgo }], []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.stale).toBe(true);
  });

  it("sets advisoryActive when rain advisory is flagged with enough precipitation", async () => {
    setupGetDetails(
      { data: SITE_DATA },
      [FRESH_READING],
      [{ recorded_at: now, precipitation_inches_48h: 1.5, advisory_active: true }],
    );

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.advisoryActive).toBe(true);
  });

  it("does not set advisoryActive when advisory_active flag is false", async () => {
    setupGetDetails(
      { data: SITE_DATA },
      [FRESH_READING],
      [{ recorded_at: now, precipitation_inches_48h: 2.0, advisory_active: false }],
    );

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.advisoryActive).toBe(false);
  });

  it("computes geometric mean when 5 or more fresh readings exist", async () => {
    const readings = Array.from({ length: 5 }, (_, i) => ({
      ...FRESH_READING,
      id: `read-${i}`,
      e_coli_mpn: 80 + i * 20,
    }));
    setupGetDetails({ data: SITE_DATA }, readings, []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    // With 5 readings, calculateGeometricMean returns a value.
    expect(r.geometricMean).not.toBeNull();
    expect(typeof (r.geometricMean as Record<string, unknown>).value).toBe("number");
  });

  it("uses enterococci values for geometric mean on tidal_brackish sites", async () => {
    const tidalSite = { ...SITE_DATA, water_body_type: "tidal_brackish" };
    const tidalReadings = Array.from({ length: 5 }, (_, i) => ({
      ...FRESH_READING,
      id: `read-${i}`,
      e_coli_mpn: null,
      enterococci_cce: 10 + i * 5,
    }));
    setupGetDetails({ data: tidalSite }, tidalReadings, []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.geometricMean).not.toBeNull();
  });

  it("returns unsafe status for an e_coli reading above threshold", async () => {
    setupGetDetails({ data: SITE_DATA }, [{ ...FRESH_READING, e_coli_mpn: 500 }], []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect(r.status).toBe("unsafe");
  });

  it("includes all readings in the returned readings array", async () => {
    const readings = Array.from({ length: 3 }, (_, i) => ({
      ...FRESH_READING,
      id: `read-${i}`,
    }));
    setupGetDetails({ data: SITE_DATA }, readings, []);

    const r = (await getDetailsHandler({ data: { siteId: SITE_ID } })) as Record<string, unknown>;

    expect((r.readings as unknown[]).length).toBe(3);
  });
});

// ── getSiteDetailsBySlug ───────────────────────────────────────────────────────
describe("getSiteDetailsBySlug", () => {
  it("returns null when no site matches the given slug", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null }));

    const result = await getBySlugHandler({ data: { slug: "does-not-exist" } });

    expect(result).toBeNull();
  });

  it("returns full site details for a valid slug", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: { id: SITE_ID } }))
      .mockReturnValueOnce(makeChain({ data: SITE_DATA }))
      .mockReturnValueOnce(makeChain({ data: [FRESH_READING] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    const r = (await getBySlugHandler({ data: { slug: "four-mile-run" } })) as Record<
      string,
      unknown
    >;

    expect(r.site).toMatchObject({ name: "Four Mile Run" });
    expect(r.status).toBe("pass");
    expect(r.advisoryActive).toBe(false);
  });

  it("returns null when the site fetch errors after the slug lookup", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: { id: SITE_ID } }))
      .mockReturnValueOnce(makeChain({ data: null, error: { message: "DB error" } }))
      .mockReturnValueOnce(makeChain({ data: [] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    const result = await getBySlugHandler({ data: { slug: "four-mile-run" } });

    expect(result).toBeNull();
  });

  it("computes no_data status when there are no readings for the slug site", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: { id: SITE_ID } }))
      .mockReturnValueOnce(makeChain({ data: SITE_DATA }))
      .mockReturnValueOnce(makeChain({ data: [] }))
      .mockReturnValueOnce(makeChain({ data: [] }));

    const r = (await getBySlugHandler({ data: { slug: "four-mile-run" } })) as Record<
      string,
      unknown
    >;

    expect(r.status).toBe("no_data");
    expect(r.geometricMean).toBeNull();
  });

  it("sets advisoryActive via slug path when rain advisory is triggered", async () => {
    mockSupabase.from
      .mockReturnValueOnce(makeChain({ data: { id: SITE_ID } }))
      .mockReturnValueOnce(makeChain({ data: SITE_DATA }))
      .mockReturnValueOnce(makeChain({ data: [FRESH_READING] }))
      .mockReturnValueOnce(
        makeChain({
          data: [{ recorded_at: now, precipitation_inches_48h: 1.5, advisory_active: true }],
        }),
      );

    const r = (await getBySlugHandler({ data: { slug: "four-mile-run" } })) as Record<
      string,
      unknown
    >;

    expect(r.advisoryActive).toBe(true);
  });
});
