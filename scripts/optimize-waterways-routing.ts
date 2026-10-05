/**
 * Second optimization pass: split data/waterways-dmv-optimized.geojson into
 * routing-focused basin files, targeting < 10 MB combined.
 *
 * Additional reductions applied:
 *   1. Drop lake / bay / coastline (not needed for river routing)
 *   2. Re-run Douglas-Peucker on streams (ε = 0.0003, threshold = 30 nodes)
 *   3. Drop short unnamed streams (< 50 nodes, up from < 20 in pass 1)
 *
 * Output files (in data/routing/):
 *   potomac.geojson      river/canal/tidal_channel in the Potomac basin
 *   anacostia.geojson    river/canal/tidal_channel in the Anacostia basin
 *   patuxent.geojson     river/canal/tidal_channel in the Patuxent basin
 *   other-rivers.geojson remaining river/canal/tidal_channel features
 *   streams-dc.geojson   streams in the DC bbox
 *   streams-md.geojson   streams in MD (exclusive: DC-assigned streams excluded)
 *   streams-va.geojson   streams in VA (exclusive: DC/MD-assigned streams excluded)
 *
 * Run with:
 *   npx tsx scripts/optimize-waterways-routing.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WaterwayType =
  | "river"
  | "stream"
  | "canal"
  | "tidal_channel"
  | "lake"
  | "bay"
  | "coastline"
  | "drain"
  | "fairway";

interface Feature {
  type: "Feature";
  properties: { name: string; type: WaterwayType; routing: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

interface GeoJsonCollection {
  type: "FeatureCollection";
  generated?: string;
  bbox?: number[];
  counts?: Record<string, number>;
  features: Feature[];
}

// [minLat, minLng, maxLat, maxLng]
type Bbox4 = [number, number, number, number];

// ---------------------------------------------------------------------------
// Basin bboxes [minLat, minLng, maxLat, maxLng]
// ---------------------------------------------------------------------------

const POTOMAC_BBOX: Bbox4 = [38.6, -77.8, 39.4, -76.8];
const ANACOSTIA_BBOX: Bbox4 = [38.8, -77.1, 39.0, -76.9];
const PATUXENT_BBOX: Bbox4 = [38.5, -77.0, 39.2, -76.6];

// Stream region bboxes — DC is checked first (exclusive priority: DC > MD > VA)
const DC_BBOX: Bbox4 = [38.79, -77.12, 39.0, -76.91];
const MD_BBOX: Bbox4 = [37.91, -79.49, 39.73, -74.99];
const VA_BBOX: Bbox4 = [36.54, -83.68, 39.47, -75.24];

// ---------------------------------------------------------------------------
// Named waterways to verify (name → expected output file)
// ---------------------------------------------------------------------------

const VERIFY_NAMES: Array<{ name: string; expectedFile: string }> = [
  { name: "Potomac River", expectedFile: "potomac.geojson" },
  { name: "Anacostia River", expectedFile: "anacostia.geojson" },
  { name: "Patuxent River", expectedFile: "patuxent.geojson" },
  { name: "Rock Creek", expectedFile: "streams-dc.geojson" },
  { name: "Four Mile Run", expectedFile: "streams-dc.geojson" },
];

// ---------------------------------------------------------------------------
// Douglas-Peucker line simplification
// ---------------------------------------------------------------------------

function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    const pdx = point[0] - lineStart[0];
    const pdy = point[1] - lineStart[1];
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }
  return (
    Math.abs(
      dy * point[0] - dx * point[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0],
    ) / len
  );
}

function douglasPeucker(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

// ---------------------------------------------------------------------------
// Bbox helpers
// ---------------------------------------------------------------------------

function featureBbox(coords: [number, number][]): Bbox4 {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [minLat, minLng, maxLat, maxLng];
}

function bboxOverlaps(a: Bbox4, b: Bbox4): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function anyCoordInBbox(coords: [number, number][], bbox: Bbox4): boolean {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  return coords.some(
    ([lng, lat]) => lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng,
  );
}

// ---------------------------------------------------------------------------
// Write one output file and return its size and node count
// ---------------------------------------------------------------------------

function writeFile(
  outDir: string,
  filename: string,
  features: Feature[],
): { sizeMB: string; nodes: number } {
  const nodes = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  const collection: GeoJsonCollection = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    counts: { features: features.length, nodes },
    features,
  };
  const json = JSON.stringify(collection);
  writeFileSync(resolve(outDir, filename), json, "utf8");
  const sizeMB = (Buffer.byteLength(json, "utf8") / 1_048_576).toFixed(2);
  return { sizeMB, nodes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const inPath = resolve(process.cwd(), "data", "waterways-dmv-optimized.geojson");
  const outDir = resolve(process.cwd(), "data", "routing");
  mkdirSync(outDir, { recursive: true });

  // -------------------------------------------------------------------------
  // Read input
  // -------------------------------------------------------------------------

  process.stdout.write("Reading input file...");
  const raw = readFileSync(inPath, "utf8");
  const geojson = JSON.parse(raw) as GeoJsonCollection;
  const inputSizeMB = (Buffer.byteLength(raw, "utf8") / 1_048_576).toFixed(2);
  let features = geojson.features;
  const inputFeatures = features.length;
  const inputNodes = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  console.log(
    ` done (${inputFeatures.toLocaleString()} features, ${inputNodes.toLocaleString()} nodes)`,
  );

  // -------------------------------------------------------------------------
  // Step 1: Drop lake / bay / coastline
  // -------------------------------------------------------------------------

  process.stdout.write("Step 1: Dropping lake/bay/coastline...");
  const DROP_TYPES = new Set<WaterwayType>(["lake", "bay", "coastline"]);
  const before1 = features.length;
  features = features.filter((f) => !DROP_TYPES.has(f.properties.type));
  console.log(` done (${(before1 - features.length).toLocaleString()} removed)`);

  // -------------------------------------------------------------------------
  // Step 2: Re-run Douglas-Peucker on streams (ε = 0.0003, threshold = 30)
  // -------------------------------------------------------------------------

  process.stdout.write("Step 2: Re-simplifying streams (ε=0.0003, threshold=30)...");
  const DP_EPSILON = 0.0003;
  const DP_THRESHOLD = 30;
  let nodesRemoved = 0;
  for (const f of features) {
    if (f.properties.type !== "stream") continue;
    const coords = f.geometry.coordinates;
    if (coords.length <= DP_THRESHOLD) continue;
    const simplified = douglasPeucker(coords, DP_EPSILON);
    nodesRemoved += coords.length - simplified.length;
    f.geometry.coordinates = simplified;
  }
  console.log(` done (${nodesRemoved.toLocaleString()} nodes removed)`);

  // -------------------------------------------------------------------------
  // Step 3: Drop short unnamed streams (< 50 nodes after DP)
  // -------------------------------------------------------------------------

  process.stdout.write("Step 3: Dropping short unnamed streams (<50 nodes)...");
  const before3 = features.length;
  features = features.filter((f) => {
    if (f.properties.type !== "stream") return true;
    if (f.properties.name !== "") return true;
    return f.geometry.coordinates.length >= 50;
  });
  console.log(` done (${(before3 - features.length).toLocaleString()} removed)`);

  const afterNodes = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  console.log(
    `\nRemaining for routing: ${features.length.toLocaleString()} features, ${afterNodes.toLocaleString()} nodes`,
  );

  // -------------------------------------------------------------------------
  // Step 4: Classify into basin / stream-region buckets
  // -------------------------------------------------------------------------

  process.stdout.write("\nClassifying features...");

  const BASIN_TYPES = new Set<WaterwayType>(["river", "canal", "tidal_channel"]);

  const potomac: Feature[] = [];
  const anacostia: Feature[] = [];
  const patuxent: Feature[] = [];
  const otherRivers: Feature[] = [];
  const streamsDC: Feature[] = [];
  const streamsMD: Feature[] = [];
  const streamsVA: Feature[] = [];

  for (const f of features) {
    const { type, name } = f.properties;
    const nameLower = name.toLowerCase();

    if (BASIN_TYPES.has(type)) {
      const fb = featureBbox(f.geometry.coordinates);
      const inPotomac = nameLower.includes("potomac") || bboxOverlaps(fb, POTOMAC_BBOX);
      const inAnacostia = nameLower.includes("anacostia") || bboxOverlaps(fb, ANACOSTIA_BBOX);
      const inPatuxent = nameLower.includes("patuxent") || bboxOverlaps(fb, PATUXENT_BBOX);

      if (inPotomac) potomac.push(f);
      if (inAnacostia) anacostia.push(f);
      if (inPatuxent) patuxent.push(f);
      if (!inPotomac && !inAnacostia && !inPatuxent) otherRivers.push(f);
    } else if (type === "stream") {
      // Exclusive assignment: DC first (smallest bbox), then MD, then VA.
      // Prevents DC streams from duplicating into the larger MD/VA bboxes.
      if (anyCoordInBbox(f.geometry.coordinates, DC_BBOX)) {
        streamsDC.push(f);
      } else if (anyCoordInBbox(f.geometry.coordinates, MD_BBOX)) {
        streamsMD.push(f);
      } else if (anyCoordInBbox(f.geometry.coordinates, VA_BBOX)) {
        streamsVA.push(f);
      }
    }
    // drain/fairway/lake/bay/coastline already removed in step 1
  }

  console.log(" done");

  // -------------------------------------------------------------------------
  // Step 5: Write output files
  // -------------------------------------------------------------------------

  console.log("\nWriting output files...");

  const OUTPUT_FILES: Array<{ filename: string; list: Feature[] }> = [
    { filename: "potomac.geojson", list: potomac },
    { filename: "anacostia.geojson", list: anacostia },
    { filename: "patuxent.geojson", list: patuxent },
    { filename: "other-rivers.geojson", list: otherRivers },
    { filename: "streams-dc.geojson", list: streamsDC },
    { filename: "streams-md.geojson", list: streamsMD },
    { filename: "streams-va.geojson", list: streamsVA },
  ];

  const results: Array<{ filename: string; sizeMB: string; count: number; nodes: number }> = [];
  let totalSizeBytes = 0;

  for (const { filename, list } of OUTPUT_FILES) {
    process.stdout.write(`  ${filename}...`);
    const { sizeMB, nodes } = writeFile(outDir, filename, list);
    totalSizeBytes += Math.round(Number(sizeMB) * 1_048_576);
    results.push({ filename, sizeMB, count: list.length, nodes });
    console.log(
      ` ${sizeMB} MB  (${list.length.toLocaleString()} features, ${nodes.toLocaleString()} nodes)`,
    );
  }

  // -------------------------------------------------------------------------
  // Named waterway verification
  // -------------------------------------------------------------------------

  const featureByName = new Map<string, { file: string; nodes: number }>();
  for (const { filename, list } of OUTPUT_FILES) {
    for (const f of list) {
      if (!f.properties.name) continue;
      const existing = featureByName.get(f.properties.name);
      const nodes = f.geometry.coordinates.length;
      if (!existing || nodes > existing.nodes) {
        featureByName.set(f.properties.name, { file: filename, nodes });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  const totalSizeMB = (totalSizeBytes / 1_048_576).toFixed(2);
  const reductionPct = (
    ((Number(inputSizeMB) - Number(totalSizeMB)) / Number(inputSizeMB)) *
    100
  ).toFixed(1);

  console.log("\n=== Routing Split Complete ===");
  console.log(
    `Input:  ${inputSizeMB} MB  (${inputFeatures.toLocaleString()} features, ${inputNodes.toLocaleString()} nodes)`,
  );
  console.log(`Total output: ${totalSizeMB} MB  (${reductionPct}% reduction from input)`);

  console.log("\nOutput files:");
  for (const r of results) {
    const path = `data/routing/${r.filename}`.padEnd(40);
    const size = `${r.sizeMB} MB`.padEnd(9);
    const feats = r.count.toLocaleString().padStart(7);
    const nodes = r.nodes.toLocaleString().padStart(10);
    console.log(`  ${path}  ${size}  ${feats} features  ${nodes} nodes`);
  }

  console.log("\nNamed waterway node counts (post-optimization):");
  for (const { name, expectedFile } of VERIFY_NAMES) {
    const found = featureByName.get(name);
    if (found) {
      const note = found.file !== expectedFile ? ` ⚠ expected ${expectedFile}` : "";
      console.log(
        `  ${name.padEnd(25)} ${String(found.nodes).padStart(6)} nodes  → ${found.file}${note}`,
      );
    } else {
      console.log(`  ${name.padEnd(25)} NOT FOUND`);
    }
  }

  console.log(`\nOutput directory: ${outDir}`);
}

main();
