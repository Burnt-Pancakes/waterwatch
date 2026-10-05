import { describe, expect, it } from "vitest";
import {
  parseScenicRouteRequest,
  routeScenicWaterGraph,
  ScenicRouteError,
  type ScenicGraph,
  type ScenicGraphEdge,
} from "../supabase/functions/_shared/scenicRouting";
import {
  buildGraph,
  buildScenicRoutingOverpassQuery,
  validateCompiledGraph,
} from "../scripts/build-scenic-routing-graph";

const point = (id: string, lng: number, lat: number) => ({ id, lng, lat });

function pair(
  id: string,
  from: string,
  to: string,
  distanceMeters: number,
  scenic = 0,
  overrides: Partial<ScenicGraphEdge> = {},
): ScenicGraphEdge[] {
  const common = {
    distanceMeters,
    provenance: "osm_waterway" as const,
    osmWayId: 1,
    osmNodeIds: [1, 2] as [number, number],
    waterwayType: "river",
    scenic: { natural: scenic, paddling: scenic, quiet: scenic },
    ...overrides,
  };
  return [
    { id: `${id}:f`, from, to, ...common },
    { id: `${id}:r`, from: to, to: from, ...common },
  ];
}

describe("scenic water routing", () => {
  it("selects a scenic alternative within the 35% water-distance bound", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [
        point("a", -77, 38.9),
        point("b", -76.999, 38.9),
        point("c", -77, 38.901),
        point("d", -76.998, 38.9),
      ],
      edges: [
        ...pair("ab", "a", "b", 100, 0),
        ...pair("bd", "b", "d", 100, 0),
        ...pair("ac", "a", "c", 130, 1),
        ...pair("cd", "c", "d", 130, 1),
      ],
    };

    const result = routeScenicWaterGraph(
      graph,
      [
        { lng: -77, lat: 38.9 },
        { lng: -76.998, lat: 38.9 },
      ],
      { maxSnapMeters: 20 },
    );

    expect(result.legs[0].distanceMeters).toBe(260);
    expect(result.legs[0].coordinates).toContainEqual([-77, 38.901]);
    expect(result.legs[0].distanceMeters).toBeLessThanOrEqual(200 * 1.35);
  });

  it("rejects scenic alternatives beyond the detour limit", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [
        point("a", -77, 38.9),
        point("b", -76.999, 38.9),
        point("c", -77, 38.901),
        point("d", -76.998, 38.9),
      ],
      edges: [
        ...pair("ab", "a", "b", 100, 0),
        ...pair("bd", "b", "d", 100, 0),
        ...pair("ac", "a", "c", 140, 1),
        ...pair("cd", "c", "d", 140, 1),
      ],
    };

    const result = routeScenicWaterGraph(graph, [graph.nodes[0], graph.nodes[3]], {
      maxSnapMeters: 20,
    });
    expect(result.legs[0].distanceMeters).toBe(200);
    expect(result.legs[0].coordinates).not.toContainEqual([-77, 38.901]);
  });

  it("routes consecutive waypoint legs in the supplied order", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [point("a", -77, 38.9), point("b", -76.999, 38.9), point("c", -76.998, 38.9)],
      edges: [...pair("ab", "a", "b", 100), ...pair("bc", "b", "c", 100)],
    };
    const result = routeScenicWaterGraph(graph, [graph.nodes[0], graph.nodes[1], graph.nodes[2]], {
      maxSnapMeters: 20,
    });
    expect(result.legs.map((leg) => [leg.fromIndex, leg.toIndex])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(result.coordinates).toEqual([
      [-77, 38.9],
      [-76.999, 38.9],
      [-76.998, 38.9],
    ]);
  });

  it("fails closed for an unvalidated synthetic edge", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [point("a", -77, 38.9), point("b", -76.999, 38.9)],
      edges: pair("water", "a", "b", 100, 1, {
        provenance: "open_water",
        waterPolygonId: "potomac",
        validatedWater: false,
      }),
    };
    expect(() =>
      routeScenicWaterGraph(graph, [graph.nodes[0], graph.nodes[1]], { maxSnapMeters: 20 }),
    ).toThrowError(ScenicRouteError);
    try {
      routeScenicWaterGraph(graph, [graph.nodes[0], graph.nodes[1]], { maxSnapMeters: 20 });
    } catch (error) {
      expect(error).toMatchObject({ code: "ROUTE_VALIDATION_FAILED", legIndex: 0 });
    }
  });

  it("revalidates synthetic edges against original water polygons at request time", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [point("a", -77.003, 38.902), point("b", -77.001, 38.902)],
      edges: pair("water", "a", "b", 180, 1, {
        provenance: "open_water",
        waterPolygonId: "river-with-island",
        validatedWater: true,
      }),
      waterPolygons: [
        {
          id: "river-with-island",
          outer: [
            [-77.004, 38.9],
            [-77, 38.9],
            [-77, 38.904],
            [-77.004, 38.904],
            [-77.004, 38.9],
          ],
          holes: [
            [
              [-77.0025, 38.9015],
              [-77.0015, 38.9015],
              [-77.0015, 38.9025],
              [-77.0025, 38.9025],
              [-77.0025, 38.9015],
            ],
          ],
        },
      ],
    };

    expect(() =>
      routeScenicWaterGraph(graph, [graph.nodes[0], graph.nodes[1]], { maxSnapMeters: 20 }),
    ).toThrowError(ScenicRouteError);
    expect(validateCompiledGraph(graph)).toContain("Open-water edge crosses land: water:f");
  });

  it("reports a waypoint outside the verified network without a line fallback", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [point("a", -77, 38.9), point("b", -76.999, 38.9)],
      edges: pair("ab", "a", "b", 100),
    };
    try {
      routeScenicWaterGraph(graph, [graph.nodes[0], { lng: -76.5, lat: 39.5 }], {
        maxSnapMeters: 250,
      });
      throw new Error("Expected routing to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "WAYPOINT_OFF_NETWORK", legIndex: 0 });
    }
  });

  it("prefers a connected water snap over a closer isolated feature", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [
        point("isolated", -77, 38.9),
        point("river-a", -76.9995, 38.9),
        point("river-b", -76.998, 38.9),
      ],
      edges: pair("river", "river-a", "river-b", 130),
    };
    const result = routeScenicWaterGraph(
      graph,
      [
        { lng: -77, lat: 38.9 },
        { lng: -76.998, lat: 38.9 },
      ],
      { maxSnapMeters: 100 },
    );
    expect(result.coordinates[0]).toEqual([-76.9995, 38.9]);
    expect(result.legs[0].snapDistancesMeters[0]).toBeGreaterThan(0);
  });

  it("returns deterministic candidates and geometry", () => {
    const graph: ScenicGraph = {
      dataVersion: "fixture-1",
      nodes: [
        point("a", -77, 38.9),
        point("b", -76.999, 38.9),
        point("c", -76.999, 38.901),
        point("d", -76.998, 38.9),
      ],
      edges: [
        ...pair("ab", "a", "b", 100, 0.5),
        ...pair("bd", "b", "d", 100, 0.5),
        ...pair("ac", "a", "c", 110, 0.6),
        ...pair("cd", "c", "d", 110, 0.6),
      ],
    };
    const waypoints = [graph.nodes[0], graph.nodes[3]];
    expect(routeScenicWaterGraph(graph, waypoints, { maxSnapMeters: 20 })).toEqual(
      routeScenicWaterGraph(graph, waypoints, { maxSnapMeters: 20 }),
    );
  });

  it("strictly validates the v2 waypoint-object request", () => {
    expect(
      parseScenicRouteRequest({
        profile: "scenic_water",
        maxDetourRatio: 2,
        waypoints: [
          { lng: -77, lat: 38.9, name: "Launch" },
          { lng: -76.99, lat: 38.9, name: "Destination" },
        ],
      }),
    ).toMatchObject({ maxDetourRatio: 1.35 });
    expect(parseScenicRouteRequest({ waypoints: [] })).toBeNull();
    expect(
      parseScenicRouteRequest({
        profile: "scenic_water",
        waypoints: [
          { lng: Number.NaN, lat: 38.9 },
          { lng: -76.99, lat: 38.9 },
        ],
      }),
    ).toBeNull();
  });
});

describe("OSM graph compiler", () => {
  it("queries topology, canoe, water-area, hazard, and scenic features", () => {
    const query = buildScenicRoutingOverpassQuery("38.8,-77.1,39,-76.9");
    expect(query).toContain('route"="canoe');
    expect(query).toContain('natural"="water');
    expect(query).toContain("canoe_pass");
    expect(query).toContain('boundary"="protected_area');
    expect(query).toContain("out body geom");
    expect(query).toContain(".context out tags center");
    expect(query).toContain("(.routing; >;)");
  });

  it("does not connect nearby ways unless they share the same OSM node ID", () => {
    const graph = buildGraph(
      [
        {
          type: "way",
          id: 1,
          nodes: [10, 11],
          geometry: [
            { lon: -77, lat: 38.9 },
            { lon: -76.999, lat: 38.9 },
          ],
          tags: { waterway: "river" },
        },
        {
          type: "way",
          id: 2,
          nodes: [20, 21],
          geometry: [
            { lon: -76.998999, lat: 38.9 },
            { lon: -76.998, lat: 38.9 },
          ],
          tags: { waterway: "river" },
        },
      ],
      "fixture-1",
    );
    expect(() =>
      routeScenicWaterGraph(
        graph,
        [
          { lng: -77, lat: 38.9 },
          { lng: -76.998, lat: 38.9 },
        ],
        { maxSnapMeters: 20 },
      ),
    ).toThrowError(/No connected all-water route/);
  });

  it("excludes private waterways and barrier-crossing edges", () => {
    const graph = buildGraph(
      [
        {
          type: "way",
          id: 1,
          nodes: [10, 11],
          geometry: [
            { lon: -77, lat: 38.9 },
            { lon: -76.999, lat: 38.9 },
          ],
          tags: { waterway: "river", canoe: "private" },
        },
        { type: "node", id: 11, lon: -76.999, lat: 38.9, tags: { waterway: "weir" } },
      ],
      "fixture-1",
    );
    expect(graph.edges).toHaveLength(0);
    expect(graph.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "restriction", osmId: 1, reason: "canoe=private" }),
        expect.objectContaining({ kind: "barrier", osmId: 11, reason: "Uncrossable weir" }),
      ]),
    );
  });

  it("densifies source geometry so a launch can snap along a sparse OSM way", () => {
    const graph = buildGraph(
      [
        {
          type: "way",
          id: 50,
          nodes: [500, 501],
          geometry: [
            { lon: -77, lat: 38.9 },
            { lon: -76.99, lat: 38.9 },
          ],
          tags: { waterway: "river", canoe: "yes" },
        },
      ],
      "fixture-1",
    );

    const result = routeScenicWaterGraph(
      graph,
      [
        { lng: -76.995, lat: 38.9 },
        { lng: -76.99, lat: 38.9 },
      ],
      { maxSnapMeters: 60 },
    );
    expect(graph.nodes.some((node) => node.id.startsWith("osm-segment/50/"))).toBe(true);
    expect(result.legs[0].snapDistancesMeters[0]).toBeLessThan(60);
    expect(result.legs[0].waterSources).toEqual([
      expect.objectContaining({
        provenance: "osm_waterway",
        osmWayId: 50,
        osmNodeIds: [500, 501],
      }),
    ]);
    expect(graph.edges.every((edge) => edge.osmWayId === 50 && edge.osmNodeIds?.length === 2)).toBe(
      true,
    );
  });

  it("routes around an uncrossable barrier using a canoe-approved pass", () => {
    const graph = buildGraph(
      [
        {
          type: "way",
          id: 60,
          nodes: [600, 601, 602],
          geometry: [
            { lon: -77, lat: 38.9 },
            { lon: -76.999, lat: 38.9 },
            { lon: -76.998, lat: 38.9 },
          ],
          tags: { waterway: "river" },
        },
        { type: "node", id: 601, lon: -76.999, lat: 38.9, tags: { waterway: "weir" } },
        {
          type: "way",
          id: 61,
          nodes: [600, 610, 602],
          geometry: [
            { lon: -77, lat: 38.9 },
            { lon: -76.999, lat: 38.901 },
            { lon: -76.998, lat: 38.9 },
          ],
          tags: { waterway: "canoe_pass", name: "Canoe pass" },
        },
      ],
      "fixture-1",
    );

    const result = routeScenicWaterGraph(
      graph,
      [
        { lng: -77, lat: 38.9 },
        { lng: -76.998, lat: 38.9 },
      ],
      { maxSnapMeters: 20 },
    );
    expect(result.legs[0].coordinates).toContainEqual([-76.999, 38.901]);
    expect(graph.edges.some((edge) => edge.osmWayId === 60)).toBe(false);
  });

  it("keeps open-water hex edges out of island holes", () => {
    const outer = [
      { lon: -77.004, lat: 38.9 },
      { lon: -77, lat: 38.9 },
      { lon: -77, lat: 38.904 },
      { lon: -77.004, lat: 38.904 },
      { lon: -77.004, lat: 38.9 },
    ];
    const inner = [
      { lon: -77.0025, lat: 38.9015 },
      { lon: -77.0015, lat: 38.9015 },
      { lon: -77.0015, lat: 38.9025 },
      { lon: -77.0025, lat: 38.9025 },
      { lon: -77.0025, lat: 38.9015 },
    ];
    const graph = buildGraph(
      [
        { type: "way", id: 70, nodes: [700, 701, 702, 703, 700], geometry: outer },
        { type: "way", id: 71, nodes: [710, 711, 712, 713, 710], geometry: inner },
        {
          type: "relation",
          id: 72,
          members: [
            { type: "way", ref: 70, role: "outer" },
            { type: "way", ref: 71, role: "inner" },
          ],
          tags: { type: "multipolygon", natural: "water", water: "river" },
        },
      ],
      "fixture-1",
    );
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const openEdges = graph.edges.filter((edge) => edge.provenance === "open_water");
    expect(openEdges.length).toBeGreaterThan(0);
    for (const edge of openEdges) {
      const from = nodeById.get(edge.from)!;
      const to = nodeById.get(edge.to)!;
      for (let step = 0; step <= 20; step++) {
        const fraction = step / 20;
        const lng = from.lng + (to.lng - from.lng) * fraction;
        const lat = from.lat + (to.lat - from.lat) * fraction;
        expect(lng > -77.0025 && lng < -77.0015 && lat > 38.9015 && lat < 38.9025).toBe(false);
      }
    }
  });

  it("rejects unprovenanced and unvalidated compiled edges", () => {
    const errors = validateCompiledGraph({
      dataVersion: "fixture-1",
      nodes: [point("a", -77, 38.9), point("b", -76.999, 38.9)],
      edges: [
        {
          id: "synthetic-without-proof",
          from: "a",
          to: "b",
          distanceMeters: 100,
          provenance: "open_water",
          scenic: { natural: 0, paddling: 0, quiet: 1 },
        },
      ],
    });
    expect(errors).toContain("Unvalidated open-water edge: synthetic-without-proof");
  });
});
