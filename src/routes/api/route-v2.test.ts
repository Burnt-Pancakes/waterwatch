import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearScenicRouteAssetCache,
  routeScenicRequestFromAssets,
} from "@/lib/scenicRouteApi.server";
import type { ScenicGraph } from "../../../supabase/functions/_shared/scenicRouting";
import { handleScenicRouteRequest } from "./route-v2";

const manifestUrl = "https://planner.test/routing-v2/fixture/manifest.json";
const graph: ScenicGraph = {
  dataVersion: "fixture",
  nodes: [
    { id: "a", lng: -77, lat: 38.9 },
    { id: "b", lng: -76.999, lat: 38.9 },
  ],
  edges: [
    {
      id: "ab:f",
      from: "a",
      to: "b",
      distanceMeters: 100,
      provenance: "osm_waterway",
      osmWayId: 1,
      osmNodeIds: [1, 2],
      scenic: { natural: 1, paddling: 1, quiet: 1 },
    },
    {
      id: "ab:r",
      from: "b",
      to: "a",
      distanceMeters: 100,
      provenance: "osm_waterway",
      osmWayId: 1,
      osmNodeIds: [1, 2],
      scenic: { natural: 1, paddling: 1, quiet: 1 },
    },
  ],
};

const requestBody = {
  profile: "scenic_water",
  maxDetourRatio: 1.35,
  waypoints: [
    { lng: -77, lat: 38.9, name: "Launch" },
    { lng: -76.999, lat: 38.9, name: "Destination" },
  ],
};

function jsonRequest(body: unknown): Request {
  return new Request("https://planner.test/api/route-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assetFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === manifestUrl) {
      return Response.json({
        schemaVersion: 1,
        dataVersion: "fixture",
        attribution: "© OpenStreetMap contributors",
        shards: [
          {
            id: "fixture-shard",
            path: "shards/fixture.json",
            bbox: [-77.25, 38.75, -76.75, 39.0],
          },
        ],
      });
    }
    if (url === "https://planner.test/routing-v2/fixture/shards/fixture.json") {
      return Response.json(graph);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => clearScenicRouteAssetCache());

describe("POST /api/route-v2", () => {
  it("returns a structured verified route from same-origin assets", async () => {
    const response = await handleScenicRouteRequest(jsonRequest(requestBody), {
      fetchImpl: assetFetch(),
      manifestUrl,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dataVersion: "fixture",
      profile: "scenic_water",
      distanceMeters: 100,
      attribution: "© OpenStreetMap contributors",
      legs: [{ fromIndex: 0, toIndex: 1 }],
    });
  });

  it("returns a typed 422 and no geometry when a waypoint is off-network", async () => {
    const response = await handleScenicRouteRequest(
      jsonRequest({
        ...requestBody,
        waypoints: [requestBody.waypoints[0], { lng: -75, lat: 40 }],
      }),
      { fetchImpl: assetFetch(), manifestUrl },
    );
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: { code: "WAYPOINT_OFF_NETWORK", legIndex: 0 },
    });
    expect(payload).not.toHaveProperty("coordinates");
  });

  it("identifies the failed leg in a multi-leg request", async () => {
    const response = await handleScenicRouteRequest(
      jsonRequest({
        ...requestBody,
        waypoints: [
          requestBody.waypoints[0],
          requestBody.waypoints[1],
          { lng: -75, lat: 40, name: "Off network" },
        ],
      }),
      { fetchImpl: assetFetch(), manifestUrl },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "WAYPOINT_OFF_NETWORK", legIndex: 1 },
    });
  });

  it("rejects malformed requests", async () => {
    const response = await handleScenicRouteRequest(jsonRequest({ waypoints: [] }), {
      fetchImpl: assetFetch(),
      manifestUrl,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("fails safely when the deployed manifest is missing", async () => {
    const response = await handleScenicRouteRequest(jsonRequest(requestBody), {
      fetchImpl: vi.fn(async () => Response.json({}, { status: 404 })) as typeof fetch,
      manifestUrl,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROUTING_DATA_UNAVAILABLE" },
    });
  });

  it("fails safely when a shard data version does not match the manifest", async () => {
    const fetchImpl = assetFetch();
    const mismatchedFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      if (String(input).endsWith("/shards/fixture.json")) {
        return Response.json({ ...graph, dataVersion: "stale-fixture" });
      }
      return response;
    }) as typeof fetch;
    const response = await handleScenicRouteRequest(jsonRequest(requestBody), {
      fetchImpl: mismatchedFetch,
      manifestUrl,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROUTING_DATA_UNAVAILABLE" },
    });
  });

  it("caches immutable manifest and shard reads across warm requests", async () => {
    const fetchImpl = assetFetch();
    await routeScenicRequestFromAssets(requestBody, manifestUrl, fetchImpl);
    await routeScenicRequestFromAssets(requestBody, manifestUrl, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("expands the shard corridor when the first graph is disconnected", async () => {
    const endpointShard: ScenicGraph = {
      dataVersion: "fixture",
      nodes: graph.nodes,
      edges: [],
    };
    const expandingFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === manifestUrl) {
        return Response.json({
          schemaVersion: 1,
          dataVersion: "fixture",
          attribution: "© OpenStreetMap contributors",
          shards: [
            {
              id: "endpoint",
              path: "shards/endpoint.json",
              bbox: [-77.1, 38.89, -76.9, 38.91],
            },
            {
              id: "connector",
              path: "shards/connector.json",
              bbox: [-77.1, 38.96, -76.9, 38.97],
            },
          ],
        });
      }
      if (url.endsWith("/shards/endpoint.json")) return Response.json(endpointShard);
      if (url.endsWith("/shards/connector.json")) return Response.json(graph);
      return Response.json({}, { status: 404 });
    }) as typeof fetch;

    const result = await routeScenicRequestFromAssets(requestBody, manifestUrl, expandingFetch);
    expect(result.expansionKm).toBe(10);
    expect(result.loadedShards).toEqual(["endpoint", "connector"]);
    expect(result.route.distanceMeters).toBe(100);
  });
});
