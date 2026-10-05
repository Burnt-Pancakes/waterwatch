import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbRow = Record<string, unknown>;
type MockResult = { data: DbRow[] | null; error: null; count?: number };
type MockBuilder = {
  table: string;
  selectClause: string | null;
  eqs: Array<{ key: string; value: unknown }>;
  filters: Array<{ key: string; op: string; value: unknown }>;
  ins: Array<{ key: string; values: unknown[] }>;
  orderClause: unknown;
  limitValue: number | undefined;
  insertValue: unknown;
  getResult: () => MockResult;
  then(
    resolve: (value: unknown) => unknown,
    reject: (reason?: unknown) => unknown,
  ): Promise<unknown>;
  catch(onRejected: (reason: unknown) => unknown): Promise<unknown>;
  select(s: string): MockBuilder;
  eq(key: string, value: unknown): MockBuilder;
  filter(key: string, op: string, value: unknown): MockBuilder;
  in(key: string, values: unknown[]): MockBuilder;
  order(...args: unknown[]): MockBuilder;
  gte(key: string, value: unknown): MockBuilder;
  limit(value: number): MockBuilder;
  insert(value: unknown): MockBuilder;
  maybeSingle(): Promise<{ data: DbRow | null; error: null }>;
};
type MockState = {
  sites: DbRow[];
  readings: DbRow[];
  rainEvents: DbRow[];
  rpcResults: DbRow[];
};
type GetHandler = (ctx: { request: Request }) => Promise<Response>;
type RouteWithGetHandler = unknown;

const mockRpc = { current: vi.fn() };
const mockFrom = { current: vi.fn() };

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc.current(...args),
    from: (...args: unknown[]) => mockFrom.current(...args),
  },
}));

import { Route as SitesRoute } from "./sites";
import { Route as SiteDetailRoute } from "./sites/[slug]";
import { Route as SiteReadingsRoute } from "./sites/[slug]/readings";

function createBuilder(table: string) {
  const builder: MockBuilder = {
    table,
    selectClause: null,
    eqs: [] as Array<{ key: string; value: unknown }>,
    filters: [] as Array<{ key: string; op: string; value: unknown }>,
    ins: [] as Array<{ key: string; values: unknown[] }>,
    insertValue: null as unknown,
    orderClause: null,
    limitValue: undefined as number | undefined,
    then(resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) {
      try {
        const result = builder.getResult();
        return Promise.resolve(result).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    },
    catch(onRejected: (reason: unknown) => unknown) {
      return Promise.resolve(builder.getResult()).catch(onRejected);
    },
    select(selectClause: string) {
      builder.selectClause = selectClause;
      return builder;
    },
    eq(key: string, value: unknown) {
      builder.eqs.push({ key, value });
      return builder;
    },
    filter(key: string, op: string, value: unknown) {
      builder.filters.push({ key, op, value });
      return builder;
    },
    in(key: string, values: unknown[]) {
      builder.ins.push({ key, values });
      return builder;
    },
    order(...args: unknown[]) {
      builder.orderClause = args;
      return builder;
    },
    gte(key: string, value: unknown) {
      builder.eqs.push({ key, value });
      return builder;
    },
    limit(value: number) {
      builder.limitValue = value;
      return builder;
    },
    insert(value: unknown) {
      builder.insertValue = value;
      return builder;
    },
    maybeSingle() {
      const result = builder.getResult();
      const data = Array.isArray(result.data) ? (result.data[0] ?? null) : null;
      return Promise.resolve({ data: data as DbRow | null, error: null as null });
    },
    getResult: () => ({ data: null, error: null }),
  };
  return builder;
}

function createMockResult(table: string, builder: MockBuilder, state: MockState): MockResult {
  if (table === "sites") {
    const isActive = builder.eqs.find((item) => item.key === "is_active")?.value;
    const slug = builder.eqs.find((item) => item.key === "slug")?.value;
    const siteType = builder.eqs.find((item) => item.key === "site_type")?.value;
    let rows = state.sites;
    if (isActive !== undefined) rows = rows.filter((row) => row.is_active === isActive);
    if (slug !== undefined) rows = rows.filter((row) => row.slug === slug);
    if (siteType !== undefined) rows = rows.filter((row) => row.site_type === siteType);
    return { data: rows, error: null };
  }
  if (table === "readings") {
    const siteId = builder.eqs.find((item) => item.key === "site_id")?.value;
    let rows = state.readings;
    if (siteId !== undefined) rows = rows.filter((row) => row.site_id === siteId);
    return { data: rows, error: null };
  }
  if (table === "rain_events") {
    const active = builder.eqs.find((item) => item.key === "advisory_active")?.value;
    let rows = state.rainEvents;
    if (active !== undefined) rows = rows.filter((row) => row.advisory_active === active);
    return { data: rows, error: null };
  }
  if (table === "auth_rate_limits") {
    return { data: [], count: 0, error: null };
  }
  return { data: null, error: null };
}

const routeHandler = (Route: RouteWithGetHandler) =>
  (Route as { options: { server: { handlers: { GET: GetHandler } } } }).options.server.handlers.GET;

describe("/api/sites routes", () => {
  let state: MockState;

  beforeEach(() => {
    state = { sites: [], readings: [], rainEvents: [], rpcResults: [] };

    mockFrom.current = vi.fn((table: string) => {
      const builder = createBuilder(table);
      builder.getResult = () => createMockResult(table, builder, state);
      return builder;
    });

    mockRpc.current = vi.fn((_name: string, _params: unknown) => {
      return {
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: state.rpcResults, error: null }).then(resolve);
        },
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid GeoJSON FeatureCollection", async () => {
    state.rpcResults = [
      {
        site_id: "site-1",
        slug: "site-1",
        name: "Test Site",
        site_type: "kayak_launch",
        water_body_type: "freshwater",
        ada_accessible: true,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: 300,
        enterococci_cce: null,
        sampled_at: new Date().toISOString(),
        data_source: "EPA WQP",
        distance_km: 3.1,
      },
    ];

    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=38.9&lng=-77.0"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties).toMatchObject({
      status: "caution",
      isStale: false,
      e_coli_mpn: 300,
      data_source: "EPA WQP",
      distance_km: 3.1,
    });
  });

  it("filters by site_type", async () => {
    state.rpcResults = [
      {
        site_id: "site-1",
        slug: "site-1",
        name: "Site A",
        site_type: "kayak_launch",
        water_body_type: "freshwater",
        ada_accessible: true,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: 100,
        enterococci_cce: null,
        sampled_at: new Date().toISOString(),
        data_source: "EPA WQP",
        distance_km: 2,
      },
      {
        site_id: "site-2",
        slug: "site-2",
        name: "Site B",
        site_type: "boat_ramp",
        water_body_type: "freshwater",
        ada_accessible: false,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: 100,
        enterococci_cce: null,
        sampled_at: new Date().toISOString(),
        data_source: "EPA WQP",
        distance_km: 5,
      },
    ];

    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=38.9&lng=-77.0&site_type=kayak_launch"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.site_type).toBe("kayak_launch");
  });

  it("returns 400 for non-numeric lat", async () => {
    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=not-a-number&lng=-77.0"),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_query");
  });

  it("returns 400 for out-of-range lat", async () => {
    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=200&lng=-77.0"),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_query");
  });

  it("each site feature has all required GeoJSON properties", async () => {
    const sampledAt = new Date().toISOString();
    state.rpcResults = [
      {
        site_id: "site-1",
        slug: "test-site",
        name: "Test Beach",
        site_type: "beach",
        water_body_type: "tidal_brackish",
        ada_accessible: false,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: null,
        enterococci_cce: 25,
        sampled_at: sampledAt,
        data_source: "MDDNR",
        distance_km: 2.5,
      },
    ];

    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=38.9&lng=-77.0"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);

    const feature = body.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry).toMatchObject({ type: "Point", coordinates: [-77.0, 38.9] });

    const p = feature.properties;
    expect(p).toHaveProperty("id", "site-1");
    expect(p).toHaveProperty("name", "Test Beach");
    expect(p).toHaveProperty("slug", "test-site");
    expect(p).toHaveProperty("site_type", "beach");
    expect(p).toHaveProperty("water_body_type", "tidal_brackish");
    expect(p).toHaveProperty("ada_accessible", false);
    expect(p).toHaveProperty("status");
    expect(p).toHaveProperty("isStale");
    expect(p).toHaveProperty("e_coli_mpn", null);
    expect(p).toHaveProperty("enterococci_cce", 25);
    expect(p).toHaveProperty("sampled_at", sampledAt);
    expect(p).toHaveProperty("data_source", "MDDNR");
    expect(p).toHaveProperty("distance_km", 2.5);
  });

  it("includes rate limit headers", async () => {
    state.rpcResults = [];
    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites"),
    });
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBe("99");
    expect(res.headers.get("RateLimit-Reset")).toBeTruthy();
  });

  it("sorts by distance_km when location is provided", async () => {
    state.rpcResults = [
      {
        site_id: "site-1",
        slug: "site-1",
        name: "Site A",
        site_type: "kayak_launch",
        water_body_type: "freshwater",
        ada_accessible: true,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: 100,
        enterococci_cce: null,
        sampled_at: new Date().toISOString(),
        data_source: "EPA WQP",
        distance_km: 5,
      },
      {
        site_id: "site-2",
        slug: "site-2",
        name: "Site B",
        site_type: "kayak_launch",
        water_body_type: "freshwater",
        ada_accessible: true,
        lat: 38.9,
        lng: -77.0,
        e_coli_mpn: 100,
        enterococci_cce: null,
        sampled_at: new Date().toISOString(),
        data_source: "EPA WQP",
        distance_km: 1,
      },
    ];

    const res = await routeHandler(SitesRoute)({
      request: new Request("http://x/api/sites?lat=38.9&lng=-77.0"),
    });
    const body = await res.json();
    expect(body.features[0].properties.distance_km).toBe(1);
    expect(body.features[1].properties.distance_km).toBe(5);
  });

  it("returns 404 for unknown slug", async () => {
    state.sites = [];
    const detailHandler = routeHandler(SiteDetailRoute);
    const res = await detailHandler({
      request: new Request("http://x/api/sites/unknown-slug"),
    });
    expect(res.status).toBe(404);
  });

  it("computes status from latest reading for site detail", async () => {
    state.sites = [
      { id: "site-1", slug: "test-site", is_active: true, water_body_type: "freshwater" },
    ];
    state.readings = [
      {
        id: "reading-1",
        site_id: "site-1",
        sampled_at: new Date().toISOString(),
        e_coli_mpn: 999,
        enterococci_cce: null,
        sample_method: "grab",
        data_source: "EPA WQP",
        source_url: null,
        status: "pass",
      },
    ];

    const detailHandler = routeHandler(SiteDetailRoute);
    const res = await detailHandler({
      request: new Request("http://x/api/sites/test-site"),
    });

    const body = await res.json();
    expect(body.status).toBe("unsafe");
  });

  it("returns null geometric mean for fewer than 5 readings", async () => {
    state.sites = [{ id: "site-1", slug: "readings-site", is_active: true }];
    mockRpc.current.mockImplementationOnce(() => ({
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({
          data: [
            { sampled_at: new Date().toISOString(), e_coli_mpn: 10, enterococci_cce: null },
            { sampled_at: new Date().toISOString(), e_coli_mpn: 20, enterococci_cce: null },
            { sampled_at: new Date().toISOString(), e_coli_mpn: 30, enterococci_cce: null },
            { sampled_at: new Date().toISOString(), e_coli_mpn: 40, enterococci_cce: null },
          ],
          error: null,
        }).then(resolve);
      },
    }));

    const readingsHandler = routeHandler(SiteReadingsRoute);
    const res = await readingsHandler({
      request: new Request("http://x/api/sites/readings-site/readings"),
    });

    const body = await res.json();
    expect(body.geometricMean).toBeNull();
  });
});
