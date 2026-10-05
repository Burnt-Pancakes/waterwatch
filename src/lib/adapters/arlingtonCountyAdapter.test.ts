import { describe, expect, it, vi } from "vitest";
import { ArlingtonCountyAdapter, parseCsv, isValidArlingtonRow } from "./arlingtonCountyAdapter";

const CSV = `SiteID,SiteName,SampleDate,EColi_MPN,Latitude,Longitude
A1,Site One,2026-05-10T00:00:00Z,300,38.85,-77.05
A2,Site Two,2026-05-11T00:00:00Z,,38.86,-77.06
A3,Site Three,2026-05-12T00:00:00Z,150,38.87,-77.07
`;

describe("parseCsv", () => {
  it("parses a simple csv", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0].SiteID).toBe("A1");
    expect(rows[0].EColi_MPN).toBe("300");
  });
});

describe("isValidArlingtonRow", () => {
  it("rejects when EColi_MPN is missing", () => {
    expect(
      isValidArlingtonRow({
        SiteID: "A",
        SiteName: "n",
        SampleDate: "2026-05-10",
        EColi_MPN: "",
        Latitude: "1",
        Longitude: "1",
      }),
    ).toBe(false);
  });
});

function makeSupabase(csv: string) {
  return {
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([csv]), error: null }),
      }),
    },
  };
}

describe("ArlingtonCountyAdapter.fetchReadings", () => {
  it("skips invalid rows and logs row number", async () => {
    const logger = { warn: vi.fn() };
    const adapter = new ArlingtonCountyAdapter(makeSupabase(CSV) as never, "latest.csv", logger);
    const readings = await adapter.fetchReadings("*", new Date("2026-01-01"));
    expect(readings).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/Row 3/);
  });

  it("filters out readings older than `since`", async () => {
    const adapter = new ArlingtonCountyAdapter(makeSupabase(CSV) as never, "latest.csv", {
      warn: vi.fn(),
    });
    const readings = await adapter.fetchReadings("*", new Date("2026-05-11T12:00:00Z"));
    expect(readings).toHaveLength(1);
  });
});
