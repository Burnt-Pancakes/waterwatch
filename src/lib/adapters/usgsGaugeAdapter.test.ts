import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseUsgsIvResponse,
  buildUsgsIvUrl,
  UsgsGaugeAdapter,
  PARAM_GAGE_HEIGHT,
  PARAM_DISCHARGE,
} from "./usgsGaugeAdapter";

/** Build a minimal USGS IV response for one parameter code. */
function makeUsgsResponse(paramCode: string, readings: Array<{ value: string; dateTime: string }>) {
  return {
    value: {
      timeSeries: [
        {
          variable: { variableCode: [{ value: paramCode }] },
          values: [{ value: readings }],
        },
      ],
    },
  };
}

describe("parseUsgsIvResponse", () => {
  it("returns an empty map for null/undefined input", () => {
    expect(parseUsgsIvResponse(null).size).toBe(0);
    expect(parseUsgsIvResponse(undefined).size).toBe(0);
  });

  it("returns an empty map for empty timeSeries", () => {
    const payload = { value: { timeSeries: [] } };
    expect(parseUsgsIvResponse(payload).size).toBe(0);
  });

  it("parses gage height readings from parameter 00065", () => {
    const payload = makeUsgsResponse(PARAM_GAGE_HEIGHT, [
      { value: "1.42", dateTime: "2026-06-01T12:00:00.000-05:00" },
      { value: "1.38", dateTime: "2026-06-01T11:45:00.000-05:00" },
    ]);
    const result = parseUsgsIvResponse(payload);
    expect(result.has(PARAM_GAGE_HEIGHT)).toBe(true);
    expect(result.get(PARAM_GAGE_HEIGHT)).toHaveLength(2);
    expect(result.get(PARAM_GAGE_HEIGHT)?.[0].value).toBe("1.42");
  });

  it("parses discharge readings from parameter 00060", () => {
    const payload = makeUsgsResponse(PARAM_DISCHARGE, [
      { value: "450", dateTime: "2026-06-01T12:00:00.000-05:00" },
    ]);
    const result = parseUsgsIvResponse(payload);
    expect(result.has(PARAM_DISCHARGE)).toBe(true);
    expect(result.get(PARAM_DISCHARGE)?.[0].value).toBe("450");
  });

  it("parses multiple parameter codes in one response", () => {
    const payload = {
      value: {
        timeSeries: [
          {
            variable: { variableCode: [{ value: PARAM_GAGE_HEIGHT }] },
            values: [{ value: [{ value: "1.5", dateTime: "2026-06-01T12:00:00Z" }] }],
          },
          {
            variable: { variableCode: [{ value: PARAM_DISCHARGE }] },
            values: [{ value: [{ value: "320", dateTime: "2026-06-01T12:00:00Z" }] }],
          },
        ],
      },
    };
    const result = parseUsgsIvResponse(payload);
    expect(result.has(PARAM_GAGE_HEIGHT)).toBe(true);
    expect(result.has(PARAM_DISCHARGE)).toBe(true);
  });

  it("handles timeSeries entries with missing variableCode gracefully", () => {
    const payload = {
      value: {
        timeSeries: [
          {
            variable: { variableCode: [] },
            values: [{ value: [{ value: "1.0", dateTime: "2026-06-01T12:00:00Z" }] }],
          },
        ],
      },
    };
    // Should not throw and should return empty map
    expect(() => parseUsgsIvResponse(payload)).not.toThrow();
    expect(parseUsgsIvResponse(payload).size).toBe(0);
  });
});

describe("buildUsgsIvUrl", () => {
  it("builds a URL with the expected site number and default period", () => {
    const url = buildUsgsIvUrl("01652500");
    expect(url).toContain("sites=01652500");
    expect(url).toContain("period=P2D");
    expect(url).toContain("parameterCd=00065%2C00060");
    expect(url).toContain("format=json");
  });

  it("accepts a custom period", () => {
    const url = buildUsgsIvUrl("01652500", "P7D");
    expect(url).toContain("period=P7D");
  });
});

describe("UsgsGaugeAdapter", () => {
  it("has sourceId 'usgs_gauge'", () => {
    const adapter = new UsgsGaugeAdapter({} as never);
    expect(adapter.sourceId).toBe("usgs_gauge");
  });

  it("fetchSites returns empty array", async () => {
    const adapter = new UsgsGaugeAdapter({} as never);
    await expect(adapter.fetchSites()).resolves.toEqual([]);
  });

  it("normalize throws (not used by this adapter)", () => {
    const adapter = new UsgsGaugeAdapter({} as never);
    expect(() => adapter.normalize({})).toThrow();
  });

  describe("fetchReadings", () => {
    const mockGauges = [{ id: "gauge-uuid-1", usgs_site_number: "01652500" }];

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns empty array when no gauges exist in DB", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
      const adapter = new UsgsGaugeAdapter(mockSupabase as never);
      const result = await adapter.fetchReadings("*", new Date());
      expect(result).toEqual([]);
    });

    it("calls fetch for each gauge and upserts readings", async () => {
      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "river_gauges") {
            return {
              select: vi.fn().mockResolvedValue({ data: mockGauges, error: null }),
            };
          }
          // gauge_readings upsert
          return {
            upsert: upsertFn,
          };
        }),
      };

      const mockIvPayload = makeUsgsResponse(PARAM_GAGE_HEIGHT, [
        { value: "1.42", dateTime: "2026-06-01T12:00:00.000-05:00" },
      ]);
      const fetchImpl = vi.fn().mockResolvedValue(mockIvPayload);
      const adapter = new UsgsGaugeAdapter(mockSupabase as never, fetchImpl);

      const result = await adapter.fetchReadings("*", new Date());
      expect(result).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("01652500"));
      expect(upsertFn).toHaveBeenCalled();
    });

    it("returns empty array and does not throw when gauge fetch fails", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "river_gauges") {
            return {
              select: vi.fn().mockResolvedValue({ data: mockGauges, error: null }),
            };
          }
          return { upsert: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network error"));
      const adapter = new UsgsGaugeAdapter(mockSupabase as never, fetchImpl);

      await expect(adapter.fetchReadings("*", new Date())).resolves.toEqual([]);
    });
  });
});
