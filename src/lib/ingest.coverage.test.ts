import { describe, expect, it, vi } from "vitest";

// Mock the adapter imports so buildDefaultAdapters can run without real network/DB.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn(), storage: { from: vi.fn() } },
}));

import { buildDefaultAdapters } from "./ingest.server";

describe("buildDefaultAdapters", () => {
  it("returns an array of 8 adapter instances", () => {
    const adapters = buildDefaultAdapters();
    expect(adapters).toHaveLength(8);
  });

  it("includes adapters with the expected sourceIds", () => {
    const ids = buildDefaultAdapters().map((a) => a.sourceId);
    expect(ids).toContain("usgs_wqp");
    expect(ids).toContain("arlington_county");
    expect(ids).toContain("noaa_rain");
    expect(ids).toContain("osm_poi");
    expect(ids).toContain("opendatadc");
    expect(ids).toContain("mddnr");
    expect(ids).toContain("vadwr");
    expect(ids).toContain("usgs_gauge");
  });
});
