/**
 * Compress and optimize data/waterways-dmv.geojson for use in the Supabase
 * edge function. Targets under 25MB via coordinate precision reduction,
 * feature type filtering, Douglas-Peucker stream simplification, and
 * short-unnamed-stream removal.
 *
 * Run with:
 *   npx tsx scripts/optimize-waterways.ts
 *
 * Input:  data/waterways-dmv.geojson
 * Output: data/waterways-dmv-optimized.geojson
 */

import { readFileSync, writeFileSync } from "node:fs";
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

interface InputProperties {
  name: string;
  type: WaterwayType;
  routing: string;
  way_count?: number;
  length_m?: number;
  osm_ids?: number[];
  side?: string;
}

interface GeoJsonFeature {
  type: "Feature";
  properties: InputProperties;
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

interface GeoJsonCollection {
  type: "FeatureCollection";
  generated?: string;
  bbox?: number[];
  counts?: Record<string, number>;
  features: GeoJsonFeature[];
}

// ---------------------------------------------------------------------------
// Named waterways to report after optimization
// ---------------------------------------------------------------------------

const VERIFY_NAMES = [
  "Potomac River",
  "Anacostia River",
  "Patuxent River",
  "Rock Creek",
  "Four Mile Run",
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
// Coordinate rounding
// ---------------------------------------------------------------------------

function roundCoord(c: [number, number]): [number, number] {
  return [Math.round(c[0] * 100000) / 100000, Math.round(c[1] * 100000) / 100000];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const inPath = resolve(process.cwd(), "data", "waterways-dmv.geojson");
  const outPath = resolve(process.cwd(), "data", "waterways-dmv-optimized.geojson");

  // ---------------------------------------------------------------------------
  // Read input
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Step 1: Coordinate precision (7 decimal places → 5)
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 1: Coordinate precision...");
  for (const f of features) {
    f.geometry.coordinates = f.geometry.coordinates.map(roundCoord);
  }
  console.log(" done");

  // ---------------------------------------------------------------------------
  // Step 2: Drop drain and fairway
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 2: Dropping drain/fairway...");
  const DROP_TYPES = new Set<WaterwayType>(["drain", "fairway"]);
  const before2 = features.length;
  features = features.filter((f) => !DROP_TYPES.has(f.properties.type));
  console.log(` done (${(before2 - features.length).toLocaleString()} removed)`);

  // ---------------------------------------------------------------------------
  // Step 3: Douglas-Peucker simplification for dense streams
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 3: Simplifying streams...");
  const DP_EPSILON = 0.0001; // ~11m in degrees
  const DP_THRESHOLD = 50;
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

  // ---------------------------------------------------------------------------
  // Step 4: Drop short unnamed streams
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 4: Dropping short unnamed streams...");
  const before4 = features.length;
  features = features.filter((f) => {
    if (f.properties.type !== "stream") return true;
    if (f.properties.name !== "") return true; // keep named streams
    return f.geometry.coordinates.length >= 20;
  });
  console.log(` done (${(before4 - features.length).toLocaleString()} removed)`);

  // ---------------------------------------------------------------------------
  // Step 5: Strip unnecessary properties
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 5: Stripping properties...");
  for (const f of features) {
    const p = f.properties;
    f.properties = { name: p.name, type: p.type, routing: p.routing } as InputProperties;
  }
  console.log(" done");

  // ---------------------------------------------------------------------------
  // Step 6: Write minified JSON
  // ---------------------------------------------------------------------------

  process.stdout.write("Step 6: Writing minified JSON...");

  const outputNodes = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  const typeCounts = new Map<WaterwayType, number>();
  for (const f of features) {
    typeCounts.set(f.properties.type, (typeCounts.get(f.properties.type) ?? 0) + 1);
  }

  const output: GeoJsonCollection = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    bbox: geojson.bbox,
    counts: {
      river: typeCounts.get("river") ?? 0,
      stream: typeCounts.get("stream") ?? 0,
      canal: typeCounts.get("canal") ?? 0,
      tidal_channel: typeCounts.get("tidal_channel") ?? 0,
      lake: typeCounts.get("lake") ?? 0,
      bay: typeCounts.get("bay") ?? 0,
      coastline: typeCounts.get("coastline") ?? 0,
      total_features: features.length,
      total_nodes: outputNodes,
    },
    features,
  };

  const json = JSON.stringify(output);
  writeFileSync(outPath, json, "utf8");
  const outputSizeMB = (Buffer.byteLength(json, "utf8") / 1_048_576).toFixed(2);
  console.log(" done");

  // ---------------------------------------------------------------------------
  // Named waterway verification
  // ---------------------------------------------------------------------------

  const featureByName = new Map<string, GeoJsonFeature>();
  for (const f of features) {
    const name = f.properties.name;
    if (!name) continue;
    const existing = featureByName.get(name);
    if (!existing || f.geometry.coordinates.length > existing.geometry.coordinates.length) {
      featureByName.set(name, f);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const reductionPct = (
    ((Number(inputSizeMB) - Number(outputSizeMB)) / Number(inputSizeMB)) *
    100
  ).toFixed(1);

  console.log("\n=== Optimization Complete ===");
  console.log(
    `Input:  ${inputSizeMB} MB  (${inputFeatures.toLocaleString()} features, ${inputNodes.toLocaleString()} nodes)`,
  );
  console.log(
    `Output: ${outputSizeMB} MB    (${features.length.toLocaleString()} features, ${outputNodes.toLocaleString()} nodes)`,
  );
  console.log(`Reduction: ${reductionPct}%`);

  console.log("\nFeatures remaining by type:");
  console.log(`  Rivers:         ${typeCounts.get("river") ?? 0}`);
  console.log(`  Streams:        ${typeCounts.get("stream") ?? 0}`);
  console.log(`  Canals:         ${typeCounts.get("canal") ?? 0}`);
  console.log(`  Tidal channels: ${typeCounts.get("tidal_channel") ?? 0}`);
  console.log(`  Lakes:          ${typeCounts.get("lake") ?? 0}`);
  console.log(`  Bays:           ${typeCounts.get("bay") ?? 0}`);
  console.log(`  Coastline segs: ${typeCounts.get("coastline") ?? 0}`);

  console.log("\nNamed waterway node counts (post-optimization):");
  for (const name of VERIFY_NAMES) {
    const f = featureByName.get(name);
    const nodes = f ? String(f.geometry.coordinates.length).padStart(6) : "NOT FOUND";
    console.log(`  ${name.padEnd(25)} ${nodes} nodes`);
  }

  console.log(`\nOutput: ${outPath}`);
}

main();
