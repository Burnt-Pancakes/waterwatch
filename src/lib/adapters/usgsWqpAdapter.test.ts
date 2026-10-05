import { describe, expect, it, vi } from "vitest";
import { UsgsWqpAdapter, combineWqpDateTime, parseWqpValue } from "./usgsWqpAdapter";

describe("combineWqpDateTime", () => {
  it("combines date and time into ISO", () => {
    expect(combineWqpDateTime("2026-05-01", { Time: "12:34:00" })).toBe("2026-05-01T12:34:00.000Z");
  });
  it("defaults to midnight when time missing", () => {
    expect(combineWqpDateTime("2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
  });
  it("epoch 0 on empty date", () => {
    expect(combineWqpDateTime(undefined)).toBe(new Date(0).toISOString());
  });
});

describe("parseWqpValue", () => {
  it("parses numeric strings", () => {
    expect(parseWqpValue("235")).toBe(235);
    expect(parseWqpValue(410)).toBe(410);
  });
  it("returns null for empty / non-numeric", () => {
    expect(parseWqpValue("")).toBeNull();
    expect(parseWqpValue("ND")).toBeNull();
    expect(parseWqpValue(null)).toBeNull();
  });
});

describe("UsgsWqpAdapter.normalize", () => {
  const adapter = new UsgsWqpAdapter(async () => ({ results: [] }));
  it("maps an E. coli result", () => {
    const out = adapter.normalize({
      MonitoringLocationIdentifier: "USGS-01646500",
      ActivityStartDate: "2026-05-10",
      ActivityStartTime: { Time: "09:00:00" },
      CharacteristicName: "E. coli",
      ResultMeasureValue: 300,
      ResultAnalyticalMethod: { MethodName: "Colilert" },
    });
    expect(out.externalSiteId).toBe("USGS-01646500");
    expect(out.eColiMpn).toBe(300);
    expect(out.enterococciCce).toBeNull();
    expect(out.sampleMethod).toBe("Colilert");
  });
  it("maps an Enterococcus result", () => {
    const out = adapter.normalize({
      MonitoringLocationIdentifier: "USGS-XYZ",
      ActivityStartDate: "2026-05-11",
      CharacteristicName: "Enterococcus",
      ResultMeasureValue: 50,
    });
    expect(out.enterococciCce).toBe(50);
    expect(out.eColiMpn).toBeNull();
  });
});

describe("UsgsWqpAdapter.fetchReadings", () => {
  it("hits both characteristic URLs and merges results", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            MonitoringLocationIdentifier: "A",
            ActivityStartDate: "2026-05-10",
            CharacteristicName: "E. coli",
            ResultMeasureValue: 100,
          },
        ],
      })
      .mockResolvedValueOnce([
        {
          MonitoringLocationIdentifier: "B",
          ActivityStartDate: "2026-05-11",
          CharacteristicName: "Enterococcus",
          ResultMeasureValue: 25,
        },
      ]);
    const adapter = new UsgsWqpAdapter(fetchImpl);
    const out = await adapter.fetchReadings("*", new Date("2026-01-01"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
    expect(out[0].eColiMpn).toBe(100);
    expect(out[1].enterococciCce).toBe(25);
  });
});
