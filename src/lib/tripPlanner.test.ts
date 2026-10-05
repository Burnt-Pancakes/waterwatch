import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

import {
  buildShareUrl,
  buildSimpleMilestones,
  buildTimelineMilestones,
  calculateWaypoints,
  computeLegStats,
  deleteTrip,
  applyRouteDistances,
  estimateOneWayTravelMinutes,
  filterTripPlannerSites,
  findBestDeparture,
  formatDistance,
  formatPlannerDate,
  formatPlannerTime,
  formatTravelTime,
  getWaterwayRoute,
  getWindowQualityPresentation,
  haversineNM,
  hasTidalDataForRoute,
  loadMyTrips,
  loadTripPlannerSites,
  parseShareParams,
  pickDisplayWindows,
  resolveTideStation,
  routeResultToSegments,
  saveTrip,
  siteToWaypoint,
  type TripPlan,
  type TripPlannerSite,
} from "./tripPlanner";

type ChainResult = { data?: unknown; error?: { message: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order", "delete", "insert"]) {
    chain[m] = () => chain;
  }
  chain.single = () => Promise.resolve(result);
  chain.then = (...args: unknown[]) =>
    Promise.resolve(result).then(
      args[0] as (v: ChainResult) => unknown,
      args[1] as ((r: unknown) => unknown) | undefined,
    );
  return chain;
}

const THOMPSON = { lat: 38.8978, lng: -77.0562 };
const GRAVELLY = { lat: 38.8681, lng: -77.0552 };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe("haversineNM", () => {
  it("returns ~1.8 nm between Thompson Boat Center and Gravelly Point", () => {
    const nm = haversineNM(THOMPSON.lat, THOMPSON.lng, GRAVELLY.lat, GRAVELLY.lng);
    expect(nm).toBeGreaterThan(1.7);
    expect(nm).toBeLessThan(1.9);
  });

  it("returns 0 for identical coordinates", () => {
    expect(haversineNM(THOMPSON.lat, THOMPSON.lng, THOMPSON.lat, THOMPSON.lng)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("shows feet when distance is under 0.1 nm", () => {
    expect(formatDistance(0.05)).toBe("304 ft");
  });

  it("shows nautical miles when distance is 0.1 nm or more", () => {
    expect(formatDistance(0.9)).toBe("0.9 nm");
    expect(formatDistance(1.25)).toBe("1.3 nm");
  });
});

describe("formatTravelTime", () => {
  it("shows minutes when under one hour", () => {
    expect(formatTravelTime(45)).toBe("45 min");
  });

  it("shows hours and minutes when 60 minutes or more", () => {
    expect(formatTravelTime(90)).toBe("1h 30m");
    expect(formatTravelTime(120)).toBe("2h");
  });
});

describe("calculateWaypoints", () => {
  it("calls calculate_trip_waypoints RPC and maps the response", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          order_index: 0,
          name: "Launch",
          lat: "38.8978",
          lng: "-77.0562",
          distance_from_prev_nm: 0,
          travel_time_minutes: 0,
        },
        {
          order_index: 1,
          name: "Destination",
          lat: "38.8681",
          lng: "-77.0552",
          distance_from_prev_nm: 0.9,
          travel_time_minutes: 18,
          tide_direction: "Flooding",
        },
      ],
      error: null,
    });

    const departure = new Date("2026-06-17T10:00:00.000Z");
    const result = await calculateWaypoints(
      [
        { order_index: 0, name: "Launch", lat: THOMPSON.lat, lng: THOMPSON.lng },
        { order_index: 1, name: "Destination", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
      ],
      departure,
      3,
    );

    expect(mockRpc).toHaveBeenCalledWith("calculate_trip_waypoints", {
      p_waypoints: expect.any(Array),
      p_departure_time: departure.toISOString(),
      p_speed_knots: 3,
    });
    expect(result).toHaveLength(2);
    expect(result[1].distance_from_prev_nm).toBe(0.9);
    expect(result[1].tide_direction).toBe("Flooding");
  });

  it("throws when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "RPC failed" } });
    await expect(
      calculateWaypoints([{ order_index: 0, name: "A", lat: 0, lng: 0 }], new Date()),
    ).rejects.toEqual({ message: "RPC failed" });
  });
});

describe("findBestDeparture", () => {
  it("sorts windows with good quality first", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          departure_time: "2026-06-17T08:00:00Z",
          window_quality: "poor",
          recommendation: "No advantage",
        },
        {
          departure_time: "2026-06-17T06:00:00Z",
          window_quality: "good",
          recommendation: "Flood out, ebb home",
        },
        {
          departure_time: "2026-06-17T07:00:00Z",
          window_quality: "fair",
          recommendation: "Near slack",
        },
      ],
      error: null,
    });

    const result = await findBestDeparture(
      "NOAA-8594900",
      "NOAA-8594900",
      new Date("2026-06-17"),
      90,
      3,
    );

    expect(mockRpc).toHaveBeenCalledWith("find_best_departure", {
      p_origin_station: "NOAA-8594900",
      p_dest_station: "NOAA-8594900",
      p_date: "2026-06-17",
      p_travel_minutes: 90,
      p_paddling_speed_kts: 3,
    });
    expect(result[0].window_quality).toBe("good");
    expect(result[1].window_quality).toBe("fair");
    expect(result[2].window_quality).toBe("poor");
  });
});

describe("saveTrip", () => {
  it("inserts trip header then waypoints and returns trip id", async () => {
    const tripChain = makeChain({ data: { id: "trip-1" }, error: null });
    const wpChain = makeChain({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "trips") return tripChain;
      if (table === "trip_waypoints") return wpChain;
      return makeChain({ error: null });
    });

    const plan: TripPlan = {
      name: "Potomac paddle",
      trip_type: "tidal_assist",
      paddling_speed_knots: 3,
      waypoints: [
        {
          order_index: 0,
          name: "Launch",
          lat: THOMPSON.lat,
          lng: THOMPSON.lng,
          noaa_station_id: "NOAA-8594900",
        },
      ],
    };

    const id = await saveTrip(plan);
    expect(id).toBe("trip-1");
    expect(mockFrom).toHaveBeenCalledWith("trips");
    expect(mockFrom).toHaveBeenCalledWith("trip_waypoints");
  });
});

describe("loadMyTrips", () => {
  it("maps trip rows and sorted waypoints", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: [
          {
            id: "trip-1",
            name: "Morning run",
            trip_type: "out_and_back",
            departure_time: null,
            paddling_speed_knots: 3,
            notes: null,
            trip_waypoints: [
              {
                order_index: 1,
                custom_name: "End",
                lat: 38.87,
                lng: -77.05,
                site_id: null,
                noaa_station_id: null,
                estimated_arrival_at: null,
                distance_from_prev_nm: 0.9,
                travel_time_minutes: 18,
                tide_height_ft: null,
                tide_direction: null,
                minutes_to_slack: null,
              },
              {
                order_index: 0,
                custom_name: "Start",
                lat: 38.89,
                lng: -77.05,
                site_id: null,
                noaa_station_id: "NOAA-8594900",
                estimated_arrival_at: "2026-06-17T10:00:00Z",
                distance_from_prev_nm: 0,
                travel_time_minutes: 0,
                tide_height_ft: 1.2,
                tide_direction: "Flooding",
                minutes_to_slack: 30,
              },
            ],
          },
        ],
        error: null,
      }),
    );

    const trips = await loadMyTrips();
    expect(trips).toHaveLength(1);
    expect(trips[0].waypoints[0].name).toBe("Start");
    expect(trips[0].waypoints[1].name).toBe("End");
  });
});

describe("computeLegStats", () => {
  it("doubles distance for out and back trips", () => {
    const wps = [
      { order_index: 0, name: "A", lat: THOMPSON.lat, lng: THOMPSON.lng },
      { order_index: 1, name: "B", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
    ];
    const stats = computeLegStats(wps, 3, "out_and_back");
    expect(stats.roundTripDistanceNm).toBeCloseTo(stats.oneWayDistanceNm * 2, 1);
  });

  it("uses water route segment distances when provided", () => {
    const wps = [
      { order_index: 0, name: "A", lat: THOMPSON.lat, lng: THOMPSON.lng },
      { order_index: 1, name: "B", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
    ];
    const segments = [
      {
        coordinates: [
          [THOMPSON.lng, THOMPSON.lat],
          [GRAVELLY.lng, GRAVELLY.lat],
        ] as [number, number][],
        distanceNm: 5,
        viaWater: true,
      },
    ];
    const stats = computeLegStats(wps, 2.5, "out_and_back", segments);
    expect(stats.oneWayDistanceNm).toBe(5);
    expect(stats.roundTripDistanceNm).toBe(10);
    expect(stats.oneWayMinutes).toBe(120);
  });
});

describe("pickDisplayWindows", () => {
  it("returns at most 2 windows per quality bucket", () => {
    const windows = [
      { window_quality: "good", departure_time: "1" },
      { window_quality: "good", departure_time: "2" },
      { window_quality: "good", departure_time: "3" },
      { window_quality: "fair", departure_time: "4" },
      { window_quality: "poor", departure_time: "5" },
    ] as Array<{ window_quality: "good" | "fair" | "poor"; departure_time: string }>;
    const picked = pickDisplayWindows(windows as never);
    expect(picked.filter((w) => w.window_quality === "good")).toHaveLength(2);
    expect(picked).toHaveLength(4);
  });
});

describe("hasTidalDataForRoute", () => {
  it("returns false when endpoints lack tide stations", () => {
    const wps = [
      { order_index: 0, name: "A", lat: 0, lng: 0 },
      { order_index: 1, name: "B", lat: 1, lng: 1 },
    ];
    expect(hasTidalDataForRoute(wps)).toBe(false);
  });
});

describe("buildShareUrl", () => {
  it("encodes origin, dest, and depart params", () => {
    const url = buildShareUrl("https://example.com", {
      origin: "thompson-boat-center",
      dest: "gravelly-point",
      depart: "2026-06-17T10:00:00Z",
      type: "tidal_assist",
    });
    expect(url).toContain("origin=thompson-boat-center");
    expect(url).toContain("dest=gravelly-point");
    expect(url).toContain("type=tidal_assist");
  });
});

describe("parseShareParams", () => {
  it("reads query string values", () => {
    expect(
      parseShareParams("?origin=a&dest=b&type=out_and_back&depart=2026-06-17T10:00:00Z"),
    ).toEqual({
      origin: "a",
      dest: "b",
      type: "out_and_back",
      depart: "2026-06-17T10:00:00Z",
    });
  });
});

describe("filterTripPlannerSites", () => {
  const sampleSites: TripPlannerSite[] = [
    {
      id: "1",
      name: "Thompson Boat Center",
      slug: "thompson",
      lat: 1,
      lng: 1,
      site_type: "kayak_launch",
      is_tidal: true,
      tidal_gauge_station_id: "NOAA-8594900",
    },
    {
      id: "2",
      name: "Inland Lake",
      slug: "lake",
      lat: 2,
      lng: 2,
      site_type: "kayak_launch",
      is_tidal: false,
      tidal_gauge_station_id: null,
    },
  ];

  it("filters by name and tidal-only flag", () => {
    const results = filterTripPlannerSites(sampleSites, "thompson", {
      tidalOnly: true,
      limit: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0].name).toContain("Thompson");
  });
});

describe("buildTimelineMilestones", () => {
  it("includes wait milestone for tidal assist", () => {
    const wps = [
      { order_index: 0, name: "Launch", lat: THOMPSON.lat, lng: THOMPSON.lng },
      { order_index: 1, name: "Dest", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
    ];
    const window = {
      departure_time: "2026-06-17T10:00:00Z",
      arrival_time: "2026-06-17T10:30:00Z",
      return_departure_time: "2026-06-17T11:00:00Z",
      estimated_home_time: "2026-06-17T11:30:00Z",
      departure_direction: "Flooding",
      arrival_direction: "Flooding",
      return_direction: "Ebbing",
      departure_tide_state: "",
      arrival_tide_state: "",
      return_tide_state: "",
      window_quality: "good" as const,
      recommendation: "",
    };
    const milestones = buildTimelineMilestones(wps, window, "tidal_assist");
    expect(milestones.some((m) => m.kind === "wait")).toBe(true);
  });
});

describe("getWindowQualityPresentation", () => {
  it("labels poor quality as challenging", () => {
    expect(getWindowQualityPresentation("poor").label).toBe("CHALLENGING");
  });
});

describe("deleteTrip", () => {
  it("deletes by trip id", async () => {
    mockFrom.mockReturnValue(makeChain({ error: null }));
    await deleteTrip("trip-1");
    expect(mockFrom).toHaveBeenCalledWith("trips");
  });

  it("throws when delete fails", async () => {
    mockFrom.mockReturnValue(makeChain({ error: { message: "not found" } }));
    await expect(deleteTrip("missing")).rejects.toEqual({ message: "not found" });
  });
});

describe("loadTripPlannerSites", () => {
  it("returns mapped site rows on success", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: [
          {
            id: "s1",
            name: "Thompson Boat Center",
            slug: "thompson",
            lat: "38.89",
            lng: "-77.05",
            site_type: "kayak_launch",
            is_tidal: true,
            tidal_gauge_station_id: "NOAA-8594900",
          },
        ],
        error: null,
      }),
    );
    const sites = await loadTripPlannerSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe("Thompson Boat Center");
    expect(sites[0].is_tidal).toBe(true);
    expect(sites[0].lat).toBe(38.89);
  });

  it("throws when supabase returns an error", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: "DB error" } }));
    await expect(loadTripPlannerSites()).rejects.toEqual({ message: "DB error" });
  });
});

describe("resolveTideStation", () => {
  it("returns tidal_gauge_station_id when present", () => {
    expect(resolveTideStation({ is_tidal: true, tidal_gauge_station_id: "NOAA-8594900" })).toBe(
      "NOAA-8594900",
    );
  });

  it("falls back to DEFAULT_NOAA_STATION when site is tidal but has no station id", () => {
    expect(resolveTideStation({ is_tidal: true, tidal_gauge_station_id: null })).toBe(
      "NOAA-8594900",
    );
  });

  it("returns undefined when site is not tidal and has no station id", () => {
    expect(resolveTideStation({ is_tidal: false, tidal_gauge_station_id: null })).toBeUndefined();
  });
});

describe("siteToWaypoint", () => {
  it("converts a TripPlannerSite to a TripWaypoint at the given order index", () => {
    const site: TripPlannerSite = {
      id: "s1",
      name: "Thompson Boat Center",
      slug: "thompson",
      lat: 38.8978,
      lng: -77.0562,
      site_type: "kayak_launch",
      is_tidal: true,
      tidal_gauge_station_id: "NOAA-8594900",
    };
    const wp = siteToWaypoint(site, 2);
    expect(wp.order_index).toBe(2);
    expect(wp.name).toBe("Thompson Boat Center");
    expect(wp.site_id).toBe("s1");
    expect(wp.noaa_station_id).toBe("NOAA-8594900");
  });
});

describe("hasTidalDataForRoute", () => {
  it("returns true when both endpoints have tide stations", () => {
    const wps = [
      { order_index: 0, name: "A", lat: 0, lng: 0, noaa_station_id: "NOAA-1" },
      { order_index: 1, name: "B", lat: 1, lng: 1, noaa_station_id: "NOAA-2" },
    ];
    expect(hasTidalDataForRoute(wps)).toBe(true);
  });

  it("returns false when fewer than 2 waypoints", () => {
    expect(hasTidalDataForRoute([{ order_index: 0, name: "A", lat: 0, lng: 0 }])).toBe(false);
  });
});

describe("estimateOneWayTravelMinutes", () => {
  it("rounds one-way travel time for a known leg", () => {
    const wps = [
      { order_index: 0, name: "A", lat: THOMPSON.lat, lng: THOMPSON.lng },
      { order_index: 1, name: "B", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
    ];
    const minutes = estimateOneWayTravelMinutes(wps, 3);
    expect(minutes).toBeGreaterThan(30);
    expect(minutes).toBeLessThan(50);
  });
});

describe("computeLegStats — tidal_transit (one-way)", () => {
  it("does not double distance for one-way trip", () => {
    const wps = [
      { order_index: 0, name: "A", lat: THOMPSON.lat, lng: THOMPSON.lng },
      { order_index: 1, name: "B", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
    ];
    const stats = computeLegStats(wps, 3, "tidal_transit");
    expect(stats.roundTripDistanceNm).toBeCloseTo(stats.oneWayDistanceNm, 5);
    expect(stats.roundTripMinutes).toBeCloseTo(stats.oneWayMinutes, 5);
  });
});

describe("formatPlannerTime", () => {
  it("formats an ISO string to a local time string", () => {
    const result = formatPlannerTime("2026-06-17T10:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatPlannerDate", () => {
  it("formats an ISO string to a date string with weekday", () => {
    const result = formatPlannerDate("2026-06-17T10:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildSimpleMilestones", () => {
  it("returns an empty array for zero waypoints", () => {
    expect(buildSimpleMilestones([])).toEqual([]);
  });

  it("marks the first waypoint as launch and last as arrive", () => {
    const wps = [
      {
        order_index: 0,
        name: "Start",
        lat: 38.89,
        lng: -77.05,
        estimated_arrival_at: "2026-06-17T10:00:00Z",
        distance_from_prev_nm: 0,
        travel_time_minutes: 0,
      },
      {
        order_index: 1,
        name: "End",
        lat: 38.87,
        lng: -77.05,
        estimated_arrival_at: "2026-06-17T10:30:00Z",
        distance_from_prev_nm: 1.2,
        travel_time_minutes: 24,
        tide_direction: "Flooding" as const,
        tide_height_ft: 1.5,
        minutes_to_slack: 15,
      },
    ];
    const milestones = buildSimpleMilestones(wps);
    expect(milestones[0].kind).toBe("launch");
    expect(milestones[1].kind).toBe("arrive");
    expect(milestones[1].tideDirection).toBe("Flooding");
    expect(milestones[1].tideHeightFt).toBe(1.5);
  });
});

describe("buildTimelineMilestones — edge cases", () => {
  const baseWindow = {
    departure_time: "2026-06-17T10:00:00Z",
    arrival_time: "2026-06-17T10:30:00Z",
    return_departure_time: "2026-06-17T11:00:00Z",
    estimated_home_time: "2026-06-17T11:30:00Z",
    departure_direction: "Flooding",
    arrival_direction: "Flooding",
    return_direction: "Flooding",
    departure_tide_state: "",
    arrival_tide_state: "",
    return_tide_state: "",
    window_quality: "good" as const,
    recommendation: "",
  };
  const wps = [
    { order_index: 0, name: "Launch", lat: THOMPSON.lat, lng: THOMPSON.lng },
    { order_index: 1, name: "Dest", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
  ];

  it("returns empty array when window is null", () => {
    expect(buildTimelineMilestones(wps, null, "out_and_back")).toEqual([]);
  });

  it("returns empty array when fewer than 2 waypoints", () => {
    expect(buildTimelineMilestones([wps[0]], baseWindow, "out_and_back")).toEqual([]);
  });

  it("returns only launch and arrive for tidal_transit", () => {
    const milestones = buildTimelineMilestones(wps, baseWindow, "tidal_transit");
    expect(milestones).toHaveLength(2);
    expect(milestones[0].kind).toBe("launch");
    expect(milestones[1].kind).toBe("arrive");
  });

  it("adds return and home for out_and_back (no wait milestone)", () => {
    const milestones = buildTimelineMilestones(wps, baseWindow, "out_and_back");
    expect(milestones.some((m) => m.kind === "wait")).toBe(false);
    expect(milestones.some((m) => m.kind === "return_launch")).toBe(true);
    expect(milestones.some((m) => m.kind === "home")).toBe(true);
  });

  it("omits tideAssistNote when return direction is not Ebbing", () => {
    const milestones = buildTimelineMilestones(wps, baseWindow, "out_and_back");
    const ret = milestones.find((m) => m.kind === "return_launch");
    expect(ret?.tideAssistNote).toBeUndefined();
  });
});

describe("filterTripPlannerSites — additional branches", () => {
  const sampleSites: TripPlannerSite[] = [
    {
      id: "1",
      name: "Thompson Boat Center",
      slug: "thompson",
      lat: 1,
      lng: 1,
      site_type: "kayak_launch",
      is_tidal: true,
      tidal_gauge_station_id: "NOAA-8594900",
    },
    {
      id: "2",
      name: "Inland Lake",
      slug: "lake",
      lat: 2,
      lng: 2,
      site_type: "kayak_launch",
      is_tidal: false,
      tidal_gauge_station_id: null,
    },
  ];

  it("returns all sites when query is empty and tidalOnly is false", () => {
    const results = filterTripPlannerSites(sampleSites, "");
    expect(results).toHaveLength(2);
  });

  it("defaults limit to 10 when not specified", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...sampleSites[0], id: String(i) }));
    expect(filterTripPlannerSites(many, "")).toHaveLength(10);
  });
});

describe("parseShareParams — additional branches", () => {
  it("returns undefined type for an invalid trip type string", () => {
    expect(parseShareParams("?type=invalid")).toMatchObject({ type: undefined });
  });

  it("returns undefined for absent params", () => {
    const p = parseShareParams("");
    expect(p.origin).toBeUndefined();
    expect(p.dest).toBeUndefined();
    expect(p.depart).toBeUndefined();
    expect(p.type).toBeUndefined();
  });
});

describe("buildShareUrl — optional params", () => {
  it("omits depart and type when not provided", () => {
    const url = buildShareUrl("https://example.com", {
      origin: "thompson",
      dest: "gravelly",
    });
    expect(url).not.toContain("depart");
    expect(url).not.toContain("type");
    expect(url).toContain("origin=thompson");
  });
});

describe("findBestDeparture — null data", () => {
  it("returns empty array when RPC returns null data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await findBestDeparture("NOAA-1", "NOAA-2", new Date(), 60);
    expect(result).toEqual([]);
  });
});

describe("getWaterwayRoute", () => {
  const mockRouteFetch = vi.fn<typeof fetch>();
  const wps = [
    { order_index: 0, name: "Thompson", lat: THOMPSON.lat, lng: THOMPSON.lng },
    { order_index: 1, name: "Gravelly", lat: GRAVELLY.lat, lng: GRAVELLY.lng },
  ];
  const orsCoords: [number, number][] = [
    [-77.0562, 38.8978],
    [-77.055, 38.88],
    [-77.0552, 38.8681],
  ];

  it("returns null immediately when fewer than 2 waypoints", async () => {
    const result = await getWaterwayRoute([wps[0]], { fetchImpl: mockRouteFetch });
    expect(result).toBeNull();
    expect(mockRouteFetch).not.toHaveBeenCalled();
  });

  const route = {
    dataVersion: "2026-07-15",
    profile: "scenic_water" as const,
    coordinates: orsCoords,
    distanceMeters: 3200,
    scenicScore: 0.8,
    scenicHighlights: ["Natural shoreline"],
    warnings: [],
    legs: [
      {
        fromIndex: 0,
        toIndex: 1,
        coordinates: orsCoords,
        distanceMeters: 3200,
        scenicScore: 0.8,
        snapDistancesMeters: [10, 20] as [number, number],
        accessConnectors: [],
        waterProvenance: "osm_centerline" as const,
        scenicHighlights: ["Natural shoreline"],
        warnings: [],
      },
    ],
  };

  it("returns a structured scenic route from the same-origin route API", async () => {
    mockRouteFetch.mockResolvedValueOnce(Response.json(route));
    const result = await getWaterwayRoute(wps, { fetchImpl: mockRouteFetch });
    expect(result).toEqual(route);
    expect(mockRouteFetch).toHaveBeenCalledWith("/api/route-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: undefined,
      body: JSON.stringify({
        waypoints: [
          {
            lng: -77.0562,
            lat: 38.8978,
            name: "Thompson",
            siteId: undefined,
          },
          {
            lng: -77.0552,
            lat: 38.8681,
            name: "Gravelly",
            siteId: undefined,
          },
        ],
        profile: "scenic_water",
        maxDetourRatio: 1.35,
      }),
    });
  });

  it("surfaces typed failures returned by the route API", async () => {
    mockRouteFetch.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "NO_WATER_ROUTE",
            legIndex: 0,
            message: "No connected all-water route is available for leg 1.",
          },
        },
        { status: 422 },
      ),
    );
    await expect(getWaterwayRoute(wps, { fetchImpl: mockRouteFetch })).rejects.toMatchObject({
      code: "NO_WATER_ROUTE",
      legIndex: 0,
    });
  });

  it("rejects an invalid response instead of drawing a fallback", async () => {
    mockRouteFetch.mockResolvedValueOnce(
      Response.json({ error: "No waterways found in this area", fallback: true }),
    );
    await expect(getWaterwayRoute(wps, { fetchImpl: mockRouteFetch })).rejects.toMatchObject({
      code: "ROUTE_VALIDATION_FAILED",
    });
  });

  it("surfaces a data-unavailable error when fetch throws", async () => {
    mockRouteFetch.mockRejectedValueOnce(new Error("Network failure"));
    await expect(getWaterwayRoute(wps, { fetchImpl: mockRouteFetch })).rejects.toMatchObject({
      code: "ROUTING_DATA_UNAVAILABLE",
    });
  });

  it("maps route legs to paddling segments and waypoint distances", () => {
    const segments = routeResultToSegments(route);
    expect(segments).toEqual([
      {
        coordinates: orsCoords,
        distanceNm: 3200 / 1852,
        viaWater: true,
      },
    ]);
    const routed = applyRouteDistances(wps, segments);
    expect(routed[0].distance_from_prev_nm).toBe(0);
    expect(routed[1].distance_from_prev_nm).toBeCloseTo(3200 / 1852);
  });
});
