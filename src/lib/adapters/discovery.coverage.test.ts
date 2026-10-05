/**
 * Additional coverage for discovery.ts — error paths and dedup edge cases
 * not covered by the primary test file.
 */
import { describe, expect, it, vi } from "vitest";
import { persistDiscoveredSites } from "./discovery";
import type { AdapterSite } from "./base";

const baseSite: AdapterSite = {
  externalId: "x:1",
  name: "Test Marina",
  lat: 38.85,
  lng: -77.05,
  waterBodyType: "tidal_brackish",
  siteType: "marina",
};

function makeSupabaseMock(opts: {
  existingByOsmId?: Array<{ osm_id: string | null; updated_at: string | null }>;
  allSites?: Array<{ name: string; lat: number | null; lng: number | null; osm_id: string | null }>;
  existingError?: { message: string } | null;
  allSitesError?: { message: string } | null;
  insertError?: { message: string } | null;
  refreshError?: { message: string } | null;
}) {
  // Single spy: each individual test only exercises one upsert path (insert
  // OR refresh) so returning the combined error for every call is correct.
  const errorToReturn = opts.insertError ?? opts.refreshError ?? null;
  const upsertSpy = vi.fn(async () => ({ error: errorToReturn }));

  const fromMock = vi.fn(() => ({
    select: (cols: string) => {
      if (cols.includes("updated_at")) {
        return {
          in: async () => ({
            data: opts.existingByOsmId ?? [],
            error: opts.existingError ?? null,
          }),
        };
      }
      return Promise.resolve({
        data: opts.allSites ?? [],
        error: opts.allSitesError ?? null,
      });
    },
    upsert: upsertSpy,
  }));

  return { supabase: { from: fromMock } as never, upsertSpy };
}

// ── error paths ───────────────────────────────────────────────────────────────
describe("persistDiscoveredSites — error paths", () => {
  it("throws when the existing-by-osm_id lookup returns an error", async () => {
    const { supabase } = makeSupabaseMock({
      existingError: { message: "existing lookup failed" },
    });

    await expect(persistDiscoveredSites(supabase, "src", [baseSite])).rejects.toThrow(
      "existing lookup failed",
    );
  });

  it("throws when the all-sites lookup returns an error", async () => {
    const { supabase } = makeSupabaseMock({
      allSitesError: { message: "all-sites lookup failed" },
    });

    await expect(persistDiscoveredSites(supabase, "src", [baseSite])).rejects.toThrow(
      "all-sites lookup failed",
    );
  });

  it("throws when the upsert of new sites returns an error", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { message: "upsert constraint" },
    });

    await expect(persistDiscoveredSites(supabase, "src", [baseSite])).rejects.toThrow(
      "insert failed",
    );
  });

  it("throws when the upsert of refreshed sites returns an error", async () => {
    const { supabase } = makeSupabaseMock({
      existingByOsmId: [{ osm_id: "x:1", updated_at: "2020-01-01T00:00:00Z" }],
      refreshError: { message: "refresh constraint" },
    });

    await expect(persistDiscoveredSites(supabase, "src", [baseSite])).rejects.toThrow(
      "refresh failed",
    );
  });
});

// ── dedup edge cases ──────────────────────────────────────────────────────────
describe("persistDiscoveredSites — dedup edge cases", () => {
  it("does not dedup when an existing site has null lat", async () => {
    const { supabase } = makeSupabaseMock({
      allSites: [{ name: "test marina", lat: null, lng: -77.05, osm_id: "other:1" }],
    });

    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);

    // lat is null → distance check skipped → site is inserted
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("does not dedup when names differ even if within radius", async () => {
    const { supabase } = makeSupabaseMock({
      allSites: [{ name: "different marina", lat: 38.85, lng: -77.05, osm_id: "other:2" }],
    });

    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);

    expect(result.inserted).toBe(1);
  });

  it("handles the case where an existing row has null updated_at", async () => {
    const now = new Date("2026-05-20T00:00:00Z");
    const { supabase } = makeSupabaseMock({
      existingByOsmId: [{ osm_id: "x:1", updated_at: null }],
    });

    const result = await persistDiscoveredSites(supabase, "src", [baseSite], {
      skipIfRefreshedWithinDays: 7,
      nowFn: () => now,
    });

    // updated_at is null → cannot compare → site is refreshed, not skipped
    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("returns early with zero counts when sites list is empty", async () => {
    const { supabase } = makeSupabaseMock({});

    const result = await persistDiscoveredSites(supabase, "src", []);

    expect(result).toEqual({ inserted: 0, refreshed: 0, skipped: 0 });
  });

  it("skips existing rows whose osm_id is null (osm_id falsy branch)", async () => {
    // Existing row with null osm_id — existingMap.set is never called for it.
    const { supabase } = makeSupabaseMock({
      existingByOsmId: [{ osm_id: null, updated_at: null }],
    });

    const result = await persistDiscoveredSites(supabase, "src", [baseSite]);

    // The null-osm_id row never matched, so baseSite is treated as a fresh insert.
    expect(result.inserted).toBe(1);
  });

  it("uses the default Date.now when nowFn is not provided with skipIfRefreshedWithinDays", async () => {
    const { supabase } = makeSupabaseMock({
      // The site was last updated 6 years ago — safely older than 7 days.
      existingByOsmId: [{ osm_id: "x:1", updated_at: "2020-01-01T00:00:00Z" }],
    });

    const result = await persistDiscoveredSites(supabase, "src", [baseSite], {
      skipIfRefreshedWithinDays: 7,
      // No nowFn provided → default () => new Date() is used.
    });

    // 2020 is > 7 days ago → row is refreshed, not skipped.
    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
