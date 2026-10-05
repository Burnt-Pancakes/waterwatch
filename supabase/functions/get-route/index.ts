import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function polylineLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

// Find the nearest point along any segment of the polyline (not just nodes).
// Returns the segment index, interpolation fraction along that segment, and distance.
function nearestSegmentPoint(
  polyline: [number, number][],
  target: [number, number],
): { index: number; fraction: number; dist: number } {
  let bestIdx = 0;
  let bestFrac = 0;
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;

    let frac = 0;
    if (len2 > 0) {
      frac = Math.max(0, Math.min(1, ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / len2));
    }

    const proj: [number, number] = [a[0] + frac * dx, a[1] + frac * dy];
    const dist = haversineMeters(target, proj);

    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestFrac = frac;
    }
  }

  // Snap to the nearer endpoint of the best segment
  return {
    index: bestFrac > 0.5 ? bestIdx + 1 : bestIdx,
    fraction: bestFrac,
    dist: bestDist,
  };
}

// ---------------------------------------------------------------------------
// Supabase Storage waterway file cache
// ---------------------------------------------------------------------------

const STORAGE_BASE = "https://nchorqfnmbngewnhgcvh.supabase.co/storage/v1/object/waterways";

// Module-level cache — persists across warm invocations
const fileCache = new Map<string, [number, number][][]>();
const cacheTimestamps = new Map<string, number>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StorageFeature {
  geometry?: {
    type: string;
    coordinates: [number, number][];
  };
}

async function loadWaterwayFile(filename: string): Promise<[number, number][][]> {
  const now = Date.now();
  const cached = fileCache.get(filename);
  const ts = cacheTimestamps.get(filename) ?? 0;

  if (cached && now - ts < CACHE_TTL_MS) {
    return cached;
  }

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const url = `${STORAGE_BASE}/${filename}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "User-Agent": "WaterVoiceDMV/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Storage fetch failed: ${filename} → ${res.status}`);
  }

  const geojson = (await res.json()) as { features: StorageFeature[] };

  const ways: [number, number][][] = geojson.features
    .filter(
      (f): f is Required<StorageFeature> =>
        f.geometry?.type === "LineString" && (f.geometry?.coordinates?.length ?? 0) >= 2,
    )
    .map((f) => f.geometry.coordinates);

  fileCache.set(filename, ways);
  cacheTimestamps.set(filename, now);

  console.log(`Loaded ${filename}: ${ways.length} features`);

  return ways;
}

function selectBasinFiles(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
): string[] {
  const files: string[] = [];

  // Potomac basin — DC/MD/VA corridor
  if (maxLon > -77.8 && minLon < -76.8 && maxLat > 38.6 && minLat < 39.4) {
    files.push("potomac.geojson");
  }

  // Anacostia basin
  if (maxLon > -77.1 && minLon < -76.9 && maxLat > 38.8 && minLat < 39.0) {
    files.push("anacostia.geojson");
  }

  // Patuxent basin
  if (maxLon > -77.0 && minLon < -76.5 && maxLat > 38.5 && minLat < 39.3) {
    files.push("patuxent.geojson");
  }

  // DC streams
  if (maxLon > -77.12 && minLon < -76.91 && maxLat > 38.79 && minLat < 39.0) {
    files.push("streams-dc.geojson");
  }

  // MD streams (rough bbox)
  if (
    maxLon > -79.49 &&
    minLon < -74.99 &&
    maxLat > 37.91 &&
    minLat < 39.73 &&
    !files.includes("streams-md.geojson")
  ) {
    files.push("streams-md.geojson");
  }

  // VA streams (rough bbox)
  if (
    maxLon > -83.68 &&
    minLon < -75.24 &&
    maxLat > 36.54 &&
    minLat < 39.47 &&
    !files.includes("streams-va.geojson")
  ) {
    files.push("streams-va.geojson");
  }

  // Fallback: other-rivers when nothing basin-specific matched
  if (files.length === 0) {
    files.push("other-rivers.geojson");
  }

  return files;
}

async function fetchRiverWays(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
): Promise<[number, number][][]> {
  const filenames = selectBasinFiles(minLat, minLon, maxLat, maxLon);

  console.log("Loading basin files:", filenames);

  const allWays: [number, number][][] = [];

  await Promise.all(
    filenames.map(async (filename) => {
      const ways = await loadWaterwayFile(filename);
      allWays.push(...ways);
    }),
  );

  return allWays;
}

function stitchWays(ways: [number, number][][]): [number, number][] {
  if (ways.length === 0) return [];
  if (ways.length === 1) return ways[0];

  const result: [number, number][] = [...ways[0]];
  const remaining = new Set(Array.from({ length: ways.length - 1 }, (_, i) => i + 1));

  while (remaining.size > 0) {
    const lastPt = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = 500;
    let reversed = false;

    for (const idx of remaining) {
      const way = ways[idx];
      const dStart = haversineMeters(lastPt, way[0]);
      const dEnd = haversineMeters(lastPt, way[way.length - 1]);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = idx;
        reversed = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = idx;
        reversed = true;
      }
    }

    if (bestIdx === -1) break;

    const way = reversed ? [...ways[bestIdx]].reverse() : ways[bestIdx];
    result.push(...way.slice(1));
    remaining.delete(bestIdx);
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  let body: { coordinates: [number, number][] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const coords = body.coordinates;
  if (!coords || coords.length < 2) {
    return new Response(JSON.stringify({ error: "At least 2 coordinates required" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const minLon = Math.min(...lngs) - 0.1;
    const maxLon = Math.max(...lngs) + 0.1;
    const minLat = Math.min(...lats) - 0.1;
    const maxLat = Math.max(...lats) + 0.1;

    const ways = await fetchRiverWays(minLat, minLon, maxLat, maxLon);

    if (ways.length === 0) {
      return new Response(
        JSON.stringify({ error: "No waterways found in this area", fallback: true }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    const river = stitchWays(ways);

    if (river.length < 2) {
      return new Response(
        JSON.stringify({ error: "Could not build river route", fallback: true }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    // Snap each waypoint to the nearest point along any river segment
    const snapResults = coords.map((wp) => nearestSegmentPoint(river, wp));

    console.log(
      "Snap results:",
      JSON.stringify(snapResults.map((r) => ({ index: r.index, dist: Math.round(r.dist) }))),
    );

    const indices = snapResults.map((r) => r.index);
    let startIdx = Math.min(...indices);
    let endIdx = Math.max(...indices);

    console.log("River length:", river.length, "Route segment:", startIdx, "->", endIdx);

    // If both waypoints snapped to the same or adjacent node, expand the window
    if (endIdx - startIdx < 2) {
      startIdx = Math.max(0, startIdx - 5);
      endIdx = Math.min(river.length - 1, endIdx + 5);
    }

    if (endIdx - startIdx < 2) {
      return new Response(
        JSON.stringify({
          error: "Waypoints too close or snapped to same river segment",
          fallback: true,
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const routeCoords = river.slice(startIdx, endIdx + 1);

    if (routeCoords.length < 2) {
      return new Response(
        JSON.stringify({ error: "Waypoints too close or same location", fallback: true }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const distanceMeters = polylineLength(routeCoords);

    // Snap distance too small means the projection landed in the wrong place
    if (distanceMeters < 100) {
      return new Response(
        JSON.stringify({
          error: "Route distance too short — snapping likely failed",
          fallback: true,
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({
        coordinates: routeCoords,
        distance_meters: Math.round(distanceMeters),
        snapped: true,
        source: "Supabase Storage / waterway centerlines",
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (err) {
    console.error("Route error:", err);
    return new Response(
      JSON.stringify({ error: "Routing failed", details: String(err), fallback: true }),
      { status: 502, headers: JSON_HEADERS },
    );
  }
});
