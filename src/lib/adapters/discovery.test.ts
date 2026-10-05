import { describe, expect, it, vi } from "vitest";
import { persistDiscoveredSites } from "./discovery";
import type { AdapterSite } from "./base";

function makeSupabaseMock(opts: {
  existingByOsmId?: Array<{ osm_id: string; updated_at: string | null }>;
  allSites?: Array<{ name: string; lat: number; lng: number; osm_id: string | null }>;
}) {
  const upsertSpy = vi.fn(async () => ({ error: null }));
  const fromMock = vi.fn(() => ({
    select: (cols: string) => {
      if (cols.includes("updated_at")) {
        return { in: async () => ({ data: opts.existingByOsmId ?? [], error: null }) };
      }
      return Promise.resolve({ data: opts.allSites ?? [], error: null });
    },
    upsert: upsertSpy,
  }));
  return { supabase: { from: fromMock } as never, upsertSpy };
}

const baseSite: AdapterSite = {
  externalId: "x:1",
  name: "Test Marina",
  lat: 38.85,
  lng: -77.05,
  waterBodyType: "tidal_brackish",
  siteType: "marina",
};

describe("persistDiscoveredSites", () => {
  it("inserts new sites with is_active=false", async () => {
    const { supabase, upsertSpy } = makeSupabaseMock({});
    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);
    expect(result).toEqual({ inserted: 1, refreshed: 0, skipped: 0 });
    const [rows] = upsertSpy.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].osm_id).toBe("x:1");
    expect(rows[0].data_source_ids).toEqual(["src"]);
  });

  it("skips a candidate within 100m of an existing same-named site", async () => {
    const { supabase, upsertSpy } = makeSupabaseMock({
      allSites: [
        // ~30m away from baseSite — should dedup.
        { name: "test marina", lat: 38.8503, lng: -77.0501, osm_id: "other:9" },
      ],
    });
    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);
    expect(result).toEqual({ inserted: 0, refreshed: 0, skipped: 1 });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("does NOT dedup a same-named site that is far away", async () => {
    const { supabase } = makeSupabaseMock({
      allSites: [
        // ~10km away.
        { name: "test marina", lat: 38.95, lng: -77.05, osm_id: "other:9" },
      ],
    });
    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);
    expect(result.inserted).toBe(1);
  });

  it("refreshes existing rows without writing is_active", async () => {
    const { supabase, upsertSpy } = makeSupabaseMock({
      existingByOsmId: [{ osm_id: "x:1", updated_at: "2020-01-01T00:00:00Z" }],
    });
    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);
    expect(result).toEqual({ inserted: 0, refreshed: 1, skipped: 0 });
    const [rows] = upsertSpy.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect("is_active" in rows[0]).toBe(false);
  });

  it("skips refresh when within skipIfRefreshedWithinDays", async () => {
    const now = new Date("2026-05-20T00:00:00Z");
    const { supabase, upsertSpy } = makeSupabaseMock({
      existingByOsmId: [
        { osm_id: "x:1", updated_at: new Date(now.getTime() - 2 * 86400_000).toISOString() },
      ],
    });
    const result = await persistDiscoveredSites(supabase, "src", [baseSite], {
      skipIfRefreshedWithinDays: 7,
      nowFn: () => now,
    });
    expect(result).toEqual({ inserted: 0, refreshed: 0, skipped: 1 });
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
