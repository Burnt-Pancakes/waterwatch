import {
  mergeGraphShards,
  parseScenicRouteRequest,
  routeScenicWaterGraph,
  ScenicRouteError,
  type ScenicGraph,
  type ScenicRouteResult,
  type ScenicRouteWaypoint,
} from "../../supabase/functions/_shared/scenicRouting";

const MANIFEST_TTL_MS = 5 * 60 * 1000;
const SHARD_TTL_MS = 30 * 60 * 1000;
const CORRIDOR_EXPANSION_KM = [5, 10, 20] as const;

export interface RoutingManifest {
  schemaVersion: number;
  dataVersion: string;
  attribution: string;
  shards: Array<{
    id: string;
    path: string;
    bbox: [number, number, number, number];
  }>;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface ScenicRouteServiceResult {
  route: ScenicRouteResult;
  expansionKm: number;
  loadedShards: string[];
}

const manifestCache = new Map<string, CacheEntry<RoutingManifest>>();
const shardCache = new Map<string, CacheEntry<ScenicGraph>>();
const mergedGraphCache = new Map<string, CacheEntry<ScenicGraph>>();

export function clearScenicRouteAssetCache(): void {
  manifestCache.clear();
  shardCache.clear();
  mergedGraphCache.clear();
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "WaterWatchDMV-ScenicRouter/2.0" },
  });
  if (!response.ok) throw new Error(`Routing data fetch failed (${response.status})`);
  return (await response.json()) as T;
}

async function loadManifest(
  manifestUrl: string,
  fetchImpl: typeof fetch,
): Promise<RoutingManifest> {
  const now = Date.now();
  const cached = manifestCache.get(manifestUrl);
  if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) return cached.value;
  const manifest = await fetchJson<RoutingManifest>(manifestUrl, fetchImpl);
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.dataVersion ||
    !manifest.attribution ||
    !Array.isArray(manifest.shards)
  ) {
    throw new Error("Unsupported routing manifest");
  }
  manifestCache.set(manifestUrl, { value: manifest, fetchedAt: now });
  return manifest;
}

async function loadShard(
  manifestUrl: string,
  path: string,
  dataVersion: string,
  fetchImpl: typeof fetch,
): Promise<ScenicGraph> {
  const url = new URL(path, manifestUrl).toString();
  const now = Date.now();
  const cached = shardCache.get(url);
  if (cached && now - cached.fetchedAt < SHARD_TTL_MS) return cached.value;
  const graph = await fetchJson<ScenicGraph>(url, fetchImpl);
  if (
    graph.dataVersion !== dataVersion ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    throw new Error("Invalid or mismatched routing graph shard");
  }
  shardCache.set(url, { value: graph, fetchedAt: now });
  return graph;
}

function mergeCachedShards(
  manifestUrl: string,
  dataVersion: string,
  shardIds: string[],
  shards: ScenicGraph[],
): ScenicGraph {
  const cacheKey = `${manifestUrl}|${dataVersion}|${shardIds.join(",")}`;
  const now = Date.now();
  const cached = mergedGraphCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < SHARD_TTL_MS) return cached.value;

  const graph = mergeGraphShards(shards);
  mergedGraphCache.set(cacheKey, { value: graph, fetchedAt: now });
  return graph;
}

function routeBounds(
  waypoints: ScenicRouteWaypoint[],
  paddingKm: number,
): [number, number, number, number] {
  const lngs = waypoints.map((waypoint) => waypoint.lng);
  const lats = waypoints.map((waypoint) => waypoint.lat);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const latPadding = paddingKm / 111.32;
  const lngPadding = paddingKm / (111.32 * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180)));
  return [
    Math.min(...lngs) - lngPadding,
    Math.min(...lats) - latPadding,
    Math.max(...lngs) + lngPadding,
    Math.max(...lats) + latPadding,
  ];
}

function intersects(
  left: [number, number, number, number],
  right: [number, number, number, number],
): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

export async function routeScenicRequestFromAssets(
  rawBody: unknown,
  manifestUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScenicRouteServiceResult> {
  const request = parseScenicRouteRequest(rawBody);
  if (!request) {
    throw new TypeError("Provide 2–8 valid waypoints and the scenic_water profile.");
  }

  const manifest = await loadManifest(manifestUrl, fetchImpl);
  let lastRouteError: ScenicRouteError | null = null;
  for (const expansionKm of CORRIDOR_EXPANSION_KM) {
    const bounds = routeBounds(request.waypoints, expansionKm);
    const selected = manifest.shards.filter((shard) => intersects(bounds, shard.bbox));
    const shards = await Promise.all(
      selected.map((shard) => loadShard(manifestUrl, shard.path, manifest.dataVersion, fetchImpl)),
    );
    const graph = mergeCachedShards(
      manifestUrl,
      manifest.dataVersion,
      selected.map((shard) => shard.id),
      shards,
    );
    try {
      const route = routeScenicWaterGraph(graph, request.waypoints, {
        maxDetourRatio: request.maxDetourRatio,
        maxSnapMeters: 250,
        maxCandidates: 20,
      });
      return {
        route,
        expansionKm,
        loadedShards: selected.map((shard) => shard.id),
      };
    } catch (error) {
      if (!(error instanceof ScenicRouteError)) throw error;
      lastRouteError = error;
    }
  }

  throw (
    lastRouteError ??
    new ScenicRouteError("NO_WATER_ROUTE", 0, "No verified all-water route is available.")
  );
}
