/**
 * Additional coverage for arlingtonCountyAdapter — quoted CSV parsing,
 * download errors, and adapter class methods not in the primary test file.
 */
import { describe, expect, it, vi } from "vitest";
import { ArlingtonCountyAdapter, parseCsv, isValidArlingtonRow } from "./arlingtonCountyAdapter";

// ── parseCsv — quoted fields ──────────────────────────────────────────────────
describe("parseCsv — quoted field handling", () => {
  it("parses a field that contains a comma inside quotes", () => {
    const csv = `Name,Value\n"Smith, John",42\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Name).toBe("Smith, John");
    expect(rows[0].Value).toBe("42");
  });

  it('parses escaped double-quotes ("") inside a quoted field', () => {
    const csv = `Name,Value\n"He said ""hello""",99\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Name).toBe('He said "hello"');
  });

  it("handles CRLF line endings correctly", () => {
    const csv = `Name,Value\r\nAlice,1\r\nBob,2\r\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("Alice");
    expect(rows[1].Name).toBe("Bob");
  });

  it("returns an empty array for a header-only CSV with no data rows", () => {
    const csv = `SiteID,SiteName,SampleDate,EColi_MPN,Latitude,Longitude\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(0);
  });

  it("handles a completely empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles a trailing field at end of file with no newline", () => {
    const csv = `Name,Value\nAlice,1`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Name).toBe("Alice");
  });
});

// ── isValidArlingtonRow — valid row ───────────────────────────────────────────
describe("isValidArlingtonRow", () => {
  it("returns true when all required columns are non-empty", () => {
    expect(
      isValidArlingtonRow({
        SiteID: "A1",
        SiteName: "Test Site",
        SampleDate: "2026-05-10",
        EColi_MPN: "200",
        Latitude: "38.85",
        Longitude: "-77.05",
      }),
    ).toBe(true);
  });

  it("returns false when SiteID is missing", () => {
    expect(
      isValidArlingtonRow({
        SiteID: "",
        SiteName: "Test",
        SampleDate: "2026-05-10",
        EColi_MPN: "100",
        Latitude: "38.85",
        Longitude: "-77.05",
      }),
    ).toBe(false);
  });

  it("returns false when Latitude is whitespace only", () => {
    expect(
      isValidArlingtonRow({
        SiteID: "A1",
        SiteName: "Test",
        SampleDate: "2026-05-10",
        EColi_MPN: "100",
        Latitude: "   ",
        Longitude: "-77.05",
      }),
    ).toBe(false);
  });
});

// ── ArlingtonCountyAdapter — fetchSites ───────────────────────────────────────
describe("ArlingtonCountyAdapter — fetchSites", () => {
  it("returns an empty array (no site discovery for Arlington CSV adapter)", async () => {
    const adapter = new ArlingtonCountyAdapter({} as never);
    expect(await adapter.fetchSites()).toEqual([]);
  });
});

// ── ArlingtonCountyAdapter.fetchReadings — download error ────────────────────
describe("ArlingtonCountyAdapter.fetchReadings — download failure", () => {
  it("throws when the Supabase storage download returns an error", async () => {
    const supabase = {
      storage: {
        from: () => ({
          download: async () => ({
            data: null,
            error: { message: "bucket not found" },
          }),
        }),
      },
    };

    const adapter = new ArlingtonCountyAdapter(supabase as never);

    await expect(adapter.fetchReadings("*", new Date())).rejects.toThrow("bucket not found");
  });

  it("throws when data is null even without an error object", async () => {
    const supabase = {
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: null }),
        }),
      },
    };

    const adapter = new ArlingtonCountyAdapter(supabase as never);

    await expect(adapter.fetchReadings("*", new Date())).rejects.toThrow("no data");
  });
});

// ── ArlingtonCountyAdapter.normalize — edge cases ────────────────────────────
describe("ArlingtonCountyAdapter.normalize", () => {
  const adapter = new ArlingtonCountyAdapter({} as never);

  it("returns epoch when SampleDate is invalid", () => {
    const r = adapter.normalize({ SiteID: "A1", SiteName: "X", SampleDate: "bad-date" });
    expect(r.sampledAt).toBe(new Date(0).toISOString());
  });

  it("returns null eColiMpn when EColi_MPN is absent", () => {
    const r = adapter.normalize({ SiteID: "A1" });
    expect(r.eColiMpn).toBeNull();
  });

  it("maps SiteID to externalSiteId", () => {
    const r = adapter.normalize({ SiteID: "SITE-X", SampleDate: "2026-05-01", EColi_MPN: "150" });
    expect(r.externalSiteId).toBe("SITE-X");
    expect(r.eColiMpn).toBe(150);
  });

  it("filters out readings older than the since cutoff", async () => {
    const oldDate = "2020-01-01T00:00:00.000Z";
    const newDate = new Date().toISOString().slice(0, 10);
    const csv = `SiteID,SiteName,SampleDate,EColi_MPN,Latitude,Longitude
S1,Old Site,${oldDate},100,38.85,-77.05
S2,New Site,${newDate},200,38.86,-77.06
`;
    const supabase = {
      storage: {
        from: () => ({ download: async () => ({ data: new Blob([csv]), error: null }) }),
      },
    };

    const realAdapter = new ArlingtonCountyAdapter(supabase as never);
    const since = new Date("2025-01-01");
    const readings = await realAdapter.fetchReadings("*", since);

    expect(readings).toHaveLength(1);
    expect(readings[0].externalSiteId).toBe("S2");
  });
});

// ── sourceId and displayName ──────────────────────────────────────────────────
describe("ArlingtonCountyAdapter metadata", () => {
  it("has the correct sourceId and displayName", () => {
    const adapter = new ArlingtonCountyAdapter({} as never);
    expect(adapter.sourceId).toBe("arlington_county");
    expect(adapter.displayName).toBe("Arlington County");
  });
});
