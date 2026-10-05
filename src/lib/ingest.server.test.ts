import { describe, expect, it, vi } from "vitest";

// Mock the Supabase admin client BEFORE importing ingest.server so the
// module never touches real cloud infra during tests.
const upsertSpy = vi.fn(async () => ({ error: null }));
const sitesSelect = {
  select: () => ({
    eq: async () => ({
      data: [{ id: "site-uuid-1", osm_id: "osm:node/1", water_body_type: "freshwater" }],
      error: null,
    }),
  }),
};
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "sites") return sitesSelect;
      if (table === "readings") return { upsert: upsertSpy };
      return { upsert: upsertSpy };
    },
    storage: { from: () => ({}) },
  },
}));

import { runIngestion, persistReadings } from "./ingest.server";
import type { DataSourceAdapter } from "./adapters/base";

function fakeAdapter(): DataSourceAdapter {
  return {
    sourceId: "fake",
    displayName: "Fake",
    async fetchSites() {
      return [];
    },
    async fetchReadings() {
      return [
        {
          externalSiteId: "osm:node/1",
          sampledAt: new Date().toISOString(),
          eColiMpn: 100,
          enterococciCce: null,
          sampleMethod: "test",
          sourceUrl: null,
          rawPayload: { ok: true },
        },
        {
          externalSiteId: "osm:node/999",
          sampledAt: new Date().toISOString(),
          eColiMpn: 200,
          enterococciCce: null,
          sampleMethod: null,
          sourceUrl: null,
          rawPayload: null,
        },
      ];
    },
    normalize() {
      throw new Error("unused");
    },
  };
}

describe("runIngestion", () => {
  it("inserts matching readings, skips unknown sites, records sources", async () => {
    upsertSpy.mockClear();
    const result = await runIngestion(undefined, [fakeAdapter()]);
    expect(result.sourcesRun).toEqual(["fake"]);
    expect(result.readingsInserted).toBe(1);
    expect(result.readingsSkipped).toBe(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const args = upsertSpy.mock.calls[0] as unknown as [
      Array<{ site_id: string; data_source: string; status: string }>,
    ];
    const inserted = args[0][0];
    expect(inserted.site_id).toBe("site-uuid-1");
    expect(inserted.data_source).toBe("fake");
    expect(["pass", "caution", "unsafe"]).toContain(inserted.status);
  });

  it("captures adapter errors without aborting", async () => {
    const bad: DataSourceAdapter = {
      sourceId: "bad",
      displayName: "Bad",
      fetchSites: async () => [],
      fetchReadings: async () => {
        throw new Error("boom");
      },
      normalize: () => {
        throw new Error("nope");
      },
    };
    const result = await runIngestion(undefined, [bad]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("boom");
  });
});

describe("persistReadings", () => {
  it("skips readings without ecoli or enterococci", async () => {
    upsertSpy.mockClear();
    const out = await persistReadings(
      fakeAdapter(),
      [
        {
          externalSiteId: "osm:node/1",
          sampledAt: new Date().toISOString(),
          eColiMpn: null,
          enterococciCce: null,
          sampleMethod: null,
          sourceUrl: null,
          rawPayload: null,
        },
      ],
      new Map([["osm:node/1", { id: "site-uuid-1", waterBodyType: "freshwater" }]]),
    );
    expect(out.inserted).toBe(0);
    expect(out.skipped).toBe(1);
  });
});
