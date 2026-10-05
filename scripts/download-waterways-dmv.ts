/**
 * Download all waterways, water bodies, and coastline for the DC/MD/VA region
 * from the OSM Overpass API and save as GeoJSON for offline routing.
 *
 * Run with:
 *   npx tsx scripts/download-waterways-dmv.ts
 *
 * Output: data/waterways-dmv.geojson
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WaterwayType =
  | "river"
  | "stream"
  | "canal"
  | "tidal_channel"
  | "drain"
  | "fairway"
  | "lake"
  | "bay"
  | "coastline";

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface WaterwayFeature {
  id: string;
  name: string;
  type: WaterwayType;
  routing: "centerline" | "open_water" | "coastal";
  osmIds: number[];
  coordinates: [number, number][];
  side?: "water";
}

// ---------------------------------------------------------------------------
// Bounding boxes
// Virginia's full bbox (~512 MB+ response) exceeds Node.js string limits,
// so it is split into 4 sub-regions. MD is split in 2 for the same reason.
// ---------------------------------------------------------------------------

const REGIONS = [
  { name: "DC", bbox: "38.79,-77.12,39.00,-76.91", label: "DC" },
  { name: "Maryland (West)", bbox: "37.91,-79.49,39.73,-77.00", label: "Maryland" },
  { name: "Maryland (East)", bbox: "37.91,-77.00,39.73,-74.99", label: "Maryland" },
  { name: "Virginia (NW)", bbox: "37.55,-83.68,39.47,-79.50", label: "Virginia" },
  { name: "Virginia (NE)", bbox: "37.55,-79.50,39.47,-75.24", label: "Virginia" },
  { name: "Virginia (SW)", bbox: "36.54,-83.68,37.55,-79.50", label: "Virginia" },
  { name: "Virginia (SE)", bbox: "36.54,-79.50,37.55,-75.24", label: "Virginia" },
] as const;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "WaterVoiceDMV/1.0 (water-voice-dmv.lovable.app)";

// ---------------------------------------------------------------------------
// Named waterways to verify
// ---------------------------------------------------------------------------

const VERIFY_NAMES = [
  "Potomac River",
  "Anacostia River",
  "Patuxent River",
  "Occoquan River",
  "Rappahannock River",
  "Shenandoah River",
  "Monocacy River",
  "Rock Creek",
  "Four Mile Run",
  "Chesapeake and Ohio Canal",
  "Chesapeake and Delaware Canal",
  "Chesapeake Bay",
  "Occoquan Reservoir",
  "Rocky Gorge Reservoir",
  "Triadelphia Reservoir",
];

// ---------------------------------------------------------------------------
// Overpass query
// ---------------------------------------------------------------------------

function buildQuery(bbox: string): string {
  return (
    `[out:json];` +
    `(` +
    `way["waterway"~"^(river|stream|canal|tidal_channel|drain|fairway)$"](${bbox});` +
    `way["natural"="water"]["water"~"^(lake|reservoir|pond|bay|lagoon)$"](${bbox});` +
    `way["natural"="coastline"](${bbox});` +
    `);` +
    `out geom;`
  );
}

// ---------------------------------------------------------------------------
// Fetch with retry
// ---------------------------------------------------------------------------

async function fetchOverpass(bbox: string, regionName: string): Promise<OverpassElement[]> {
  const query = buildQuery(bbox);
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      process.stdout.write(`Fetching ${regionName}...`);
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as OverpassResponse;
      const ways = data.elements.filter((el) => el.type === "way" && el.geometry?.length);
      console.log(` done (${ways.length} ways)`);
      return ways;
    } catch (err) {
      if (attempt === 1) {
        console.log(` failed (${String(err)}), retrying in 15s...`);
        await sleep(15_000);
      } else {
        throw new Error(`Failed to fetch ${regionName} after 2 attempts: ${String(err)}`);
      }
    }
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyElement(el: OverpassElement): WaterwayType | null {
  const tags = el.tags ?? {};
  const ww = tags["waterway"];
  const nat = tags["natural"];
  const water = tags["water"];

  if (ww === "river") return "river";
  if (ww === "stream") return "stream";
  if (ww === "canal") return "canal";
  if (ww === "tidal_channel") return "tidal_channel";
  if (ww === "drain") return "drain";
  if (ww === "fairway") return "fairway";
  if (nat === "water") {
    if (water === "lake" || water === "reservoir" || water === "pond") return "lake";
    if (water === "bay" || water === "lagoon") return "bay";
  }
  if (nat === "coastline") return "coastline";
  return null;
}

function routingFor(type: WaterwayType): "centerline" | "open_water" | "coastal" {
  if (type === "lake" || type === "bay") return "open_water";
  if (type === "coastline") return "coastal";
  return "centerline";
}

// ---------------------------------------------------------------------------
// Haversine + polyline length
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Greedy stitch
// ---------------------------------------------------------------------------

function stitchWays(ways: [number, number][][]): [number, number][] {
  if (ways.length === 0) return [];
  if (ways.length === 1) return ways[0];

  const result: [number, number][] = [...ways[0]];
  const remaining = new Set(Array.from({ length: ways.length - 1 }, (_, i) => i + 1));

  while (remaining.size > 0) {
    const lastPt = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = 500; // max 500m gap to connect
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

// ---------------------------------------------------------------------------
// Group and stitch elements into features
// ---------------------------------------------------------------------------

interface RawWay {
  osmId: number;
  name: string;
  type: WaterwayType;
  coords: [number, number][];
}

function groupIntoFeatures(rawWays: RawWay[]): WaterwayFeature[] {
  // Group by name+type; unnamed ways stay as individual segments
  const groups = new Map<string, RawWay[]>();

  for (const way of rawWays) {
    const key = way.name ? `${way.type}::${way.name}` : `__unnamed__${way.type}__${way.osmId}`;
    const group = groups.get(key) ?? [];
    group.push(way);
    groups.set(key, group);
  }

  const features: WaterwayFeature[] = [];

  for (const [key, ways] of groups) {
    const first = ways[0];
    const coordArrays = ways.map((w) => w.coords);
    const stitched = stitchWays(coordArrays);

    if (stitched.length < 2) continue;

    const feature: WaterwayFeature = {
      id: key,
      name: first.name,
      type: first.type,
      routing: routingFor(first.type),
      osmIds: ways.map((w) => w.osmId),
      coordinates: stitched,
    };

    if (first.type === "coastline") {
      feature.side = "water";
    }

    features.push(feature);
  }

  return features;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const allRawWays: RawWay[] = [];
  const seenIds = new Set<number>();
  const labelCounts: Record<string, number> = { DC: 0, Maryland: 0, Virginia: 0 };

  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    if (i > 0) {
      process.stdout.write(`Waiting 10s before next request...`);
      await sleep(10_000);
      console.log(" done");
    }

    const elements = await fetchOverpass(region.bbox, region.name);
    let newWays = 0;

    for (const el of elements) {
      if (!el.geometry) continue;
      if (seenIds.has(el.id)) continue; // dedup across sub-regions
      seenIds.add(el.id);

      const type = classifyElement(el);
      if (!type) continue;

      const coords: [number, number][] = el.geometry.map((pt) => [pt.lon, pt.lat]);
      allRawWays.push({
        osmId: el.id,
        name: el.tags?.["name"] ?? "",
        type,
        coords,
      });
      newWays++;
    }

    labelCounts[region.label] = (labelCounts[region.label] ?? 0) + newWays;
  }

  // Alias for summary print
  const regionCounts = labelCounts;

  console.log("\nProcessing and stitching ways...");
  const features = groupIntoFeatures(allRawWays);

  // ---------------------------------------------------------------------------
  // Build counts
  // ---------------------------------------------------------------------------

  const typeCounts: Record<WaterwayType, number> = {
    river: 0,
    stream: 0,
    canal: 0,
    tidal_channel: 0,
    drain: 0,
    fairway: 0,
    lake: 0,
    bay: 0,
    coastline: 0,
  };

  let totalNodes = 0;
  for (const f of features) {
    typeCounts[f.type]++;
    totalNodes += f.coordinates.length;
  }

  const namedRivers = features.filter((f) => f.type === "river" && f.name).length;
  const unnamedRivers = features.filter((f) => f.type === "river" && !f.name).length;

  // ---------------------------------------------------------------------------
  // Build GeoJSON
  // ---------------------------------------------------------------------------

  const geojson = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    bbox: [-83.68, 36.54, -74.99, 39.73],
    counts: {
      river: typeCounts.river,
      stream: typeCounts.stream,
      canal: typeCounts.canal,
      tidal_channel: typeCounts.tidal_channel,
      drain: typeCounts.drain,
      fairway: typeCounts.fairway,
      lake: typeCounts.lake,
      bay: typeCounts.bay,
      coastline: typeCounts.coastline,
      total_features: features.length,
      total_nodes: totalNodes,
    },
    features: features.map((f) => {
      const props: Record<string, unknown> = {
        name: f.name,
        type: f.type,
        routing: f.routing,
        way_count: f.osmIds.length,
        length_m: Math.round(polylineLength(f.coordinates)),
        osm_ids: f.osmIds,
      };
      if (f.side) props["side"] = f.side;

      return {
        type: "Feature",
        properties: props,
        geometry: {
          type: "LineString",
          coordinates: f.coordinates,
        },
      };
    }),
  };

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------

  const outDir = resolve(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "waterways-dmv.geojson");
  const json = JSON.stringify(geojson);
  writeFileSync(outPath, json, "utf8");
  const fileSizeMB = (Buffer.byteLength(json, "utf8") / 1_048_576).toFixed(2);

  // ---------------------------------------------------------------------------
  // Named waterway verification
  // ---------------------------------------------------------------------------

  console.log("\nNamed waterway node counts:");
  const featureByName = new Map<string, WaterwayFeature>();
  for (const f of features) {
    if (f.name) {
      const existing = featureByName.get(f.name);
      // Keep the one with more nodes (primary feature)
      if (!existing || f.coordinates.length > existing.coordinates.length) {
        featureByName.set(f.name, f);
      }
    }
  }

  for (const name of VERIFY_NAMES) {
    const f = featureByName.get(name);
    if (f) {
      const km = (polylineLength(f.coordinates) / 1000).toFixed(1);
      console.log(
        `  ${name.padEnd(30)} ${String(f.coordinates.length).padStart(6)} nodes  (${km} km)`,
      );
    } else {
      console.log(`  ${name.padEnd(30)} NOT FOUND`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log("\n=== DMV Waterway Download Complete ===");
  console.log(`DC ways:       ${regionCounts["DC"] ?? 0}`);
  console.log(`Maryland ways: ${regionCounts["Maryland"] ?? 0}`);
  console.log(`Virginia ways: ${regionCounts["Virginia"] ?? 0}`);
  const total = Object.values(regionCounts).reduce((s, n) => s + n, 0);
  console.log(`Total ways:    ${total}`);
  console.log(`\nFeature counts:`);
  console.log(
    `  Rivers:         ${typeCounts.river} (${namedRivers} named, ${unnamedRivers} unnamed)`,
  );
  console.log(`  Streams:        ${typeCounts.stream}`);
  console.log(`  Canals:         ${typeCounts.canal}`);
  console.log(`  Tidal channels: ${typeCounts.tidal_channel}`);
  console.log(`  Drains:         ${typeCounts.drain}`);
  console.log(`  Fairways:       ${typeCounts.fairway}`);
  console.log(`  Lakes:          ${typeCounts.lake}`);
  console.log(`  Bays:           ${typeCounts.bay}`);
  console.log(`  Coastline segs: ${typeCounts.coastline}`);
  console.log(`\nFile size: ${fileSizeMB} MB`);
  console.log(`Output: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
