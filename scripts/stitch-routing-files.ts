/**
 * Spatial proximity stitching pass for data/routing/*.geojson.
 *
 * Problem: OSM stores rivers as hundreds of unnamed sub-segments split at
 * bridges, county lines, etc. The split files have 164 separate features for
 * the Potomac, with the largest named segment having only 81 nodes. The
 * router cannot reconnect these at query time.
 *
 * Fix: merge features whose endpoints are within 100 m of each other using
 * union-find, then greedily stitch each connected component into a single
 * LineString. A component inherits the name of its longest named segment.
 *
 * INPUT:  data/routing/*.geojson   (7 files, overwritten in place)
 * OUTPUT: data/routing/*.geojson   (merged features per file)
 *
 * Run with:
 *   npx tsx scripts/stitch-routing-files.ts
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WaterwayType = "river" | "stream" | "canal" | "tidal_channel" | "lake" | "bay" | "coastline";

interface Feature {
  type: "Feature";
  properties: { name: string; type: WaterwayType; routing: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

interface GeoJsonCollection {
  type: "FeatureCollection";
  generated?: string;
  counts?: Record<string, number>;
  features: Feature[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROUTING_DIR = resolve(process.cwd(), "data", "routing");
const PROXIMITY_THRESHOLD_M = 100;

// Known waterways to verify in the final summary, in order
const VERIFY_NAMES = [
  "Potomac River",
  "Anacostia River",
  "Patuxent River",
  "Rock Creek",
  "Four Mile Run",
  "Chesapeake and Ohio Canal",
];

// Pre-run sizes (MB) from optimize-waterways-routing.ts output — used in summary "was X MB"
const BEFORE_SIZE_MB: Record<string, string> = {
  "potomac.geojson": "0.69",
  "anacostia.geojson": "0.13",
  "patuxent.geojson": "0.22",
  "other-rivers.geojson": "7.68",
  "streams-dc.geojson": "0.02",
  "streams-md.geojson": "1.21",
  "streams-va.geojson": "1.94",
};

// ---------------------------------------------------------------------------
// Haversine distance (meters)
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
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i]);
  return total;
}

// ---------------------------------------------------------------------------
// Union-Find
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
  }

  components(): Map<number, number[]> {
    const groups = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      const group = groups.get(root) ?? [];
      group.push(i);
      groups.set(root, group);
    }
    return groups;
  }
}

// ---------------------------------------------------------------------------
// Proximity graph
// ---------------------------------------------------------------------------

function buildProximityGraph(features: Feature[], filename: string): UnionFind {
  const n = features.length;
  const uf = new UnionFind(n);
  const large = n > 1000;

  if (large) {
    console.log(`  Building proximity graph for ${n.toLocaleString()} features...`);
  }

  // Cache endpoints to avoid repeated array lookups
  const endpoints: Array<{
    first: [number, number];
    last: [number, number];
  }> = features.map((f) => ({
    first: f.geometry.coordinates[0],
    last: f.geometry.coordinates[f.geometry.coordinates.length - 1],
  }));

  // Track the locked name of each component root.
  // Once a component contains a named feature, its root is locked to that name.
  // Two components with different locked names must never be merged — they
  // represent distinct waterways (e.g. "Potomac River" ≠ "Rock Creek").
  // This prevents transitive confluence-node chains from linking tributaries
  // into the main river: unnamed segment B can join "Potomac River" OR join
  // "Rock Creek", but whichever it joins first locks B's component, blocking
  // the other named waterway from absorbing it.
  const compName = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    const nm = features[i].properties.name;
    if (nm !== "") compName.set(i, nm);
  }

  for (let i = 0; i < n; i++) {
    if (large && i > 0 && i % 500 === 0) {
      process.stdout.write(`  ${i}/${n} checked\r`);
    }

    const ei = endpoints[i];

    for (let j = i + 1; j < n; j++) {
      const rootI = uf.find(i);
      const rootJ = uf.find(j);
      if (rootI === rootJ) continue; // already in the same component

      // Component-level name guard: if both components are locked to different
      // names, they must stay separate even if connected by shared OSM nodes.
      const cNameI = compName.get(rootI) ?? "";
      const cNameJ = compName.get(rootJ) ?? "";
      if (cNameI !== "" && cNameJ !== "" && cNameI !== cNameJ) continue;

      const ej = endpoints[j];
      const connected =
        haversineMeters(ei.last, ej.first) <= PROXIMITY_THRESHOLD_M ||
        haversineMeters(ei.last, ej.last) <= PROXIMITY_THRESHOLD_M ||
        haversineMeters(ei.first, ej.first) <= PROXIMITY_THRESHOLD_M ||
        haversineMeters(ei.first, ej.last) <= PROXIMITY_THRESHOLD_M;

      if (connected) {
        uf.union(rootI, rootJ);
        // Propagate the locked name to the new root
        const newRoot = uf.find(rootI);
        const mergedName = cNameI !== "" ? cNameI : cNameJ;
        if (mergedName !== "") compName.set(newRoot, mergedName);
      }
    }
  }

  if (large) {
    // Clear the \r progress line
    process.stdout.write(`  ${n}/${n} checked — done\n`);
  }

  void filename; // used only for logging context above
  return uf;
}

// ---------------------------------------------------------------------------
// Greedy stitch (same logic as download-waterways-dmv.ts)
// ---------------------------------------------------------------------------

const STITCH_MAX_GAP_M = 500;

function stitchWays(ways: [number, number][][]): [number, number][] {
  if (ways.length === 0) return [];
  if (ways.length === 1) return ways[0];

  const result: [number, number][] = [...ways[0]];
  const remaining = new Set(Array.from({ length: ways.length - 1 }, (_, i) => i + 1));

  while (remaining.size > 0) {
    const lastPt = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = STITCH_MAX_GAP_M;
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

  // Append any remaining (disconnected within 500m) features without gap join
  for (const idx of remaining) {
    result.push(...ways[idx]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Merge a connected component into a single Feature
// ---------------------------------------------------------------------------

function mergeComponent(componentFeatures: Feature[]): Feature {
  if (componentFeatures.length === 1) return componentFeatures[0];

  // Name: most frequent non-empty name; tiebreak by total node count.
  // Frequency wins over length so a short named stub (e.g. "Potomac River"
  // at 81 nodes) beats a longer unnamed chain attached to it.
  const nameCounts = new Map<string, number>();
  const nameNodes = new Map<string, number>();
  for (const f of componentFeatures) {
    const nm = f.properties.name;
    if (nm !== "") {
      nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1);
      nameNodes.set(nm, (nameNodes.get(nm) ?? 0) + f.geometry.coordinates.length);
    }
  }
  let bestName = "";
  let bestScore = -1;
  for (const [nm, count] of nameCounts) {
    const score = count * 1000 + (nameNodes.get(nm) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestName = nm;
    }
  }

  // Type: most common
  const typeCounts = new Map<string, number>();
  for (const f of componentFeatures) {
    typeCounts.set(f.properties.type, (typeCounts.get(f.properties.type) ?? 0) + 1);
  }
  let bestType = componentFeatures[0].properties.type;
  let bestTypeCount = 0;
  for (const [t, count] of typeCounts) {
    if (count > bestTypeCount) {
      bestTypeCount = count;
      bestType = t as WaterwayType;
    }
  }

  // Routing: most common
  const routingCounts = new Map<string, number>();
  for (const f of componentFeatures) {
    routingCounts.set(f.properties.routing, (routingCounts.get(f.properties.routing) ?? 0) + 1);
  }
  let bestRouting = "centerline";
  let bestRoutingCount = 0;
  for (const [r, count] of routingCounts) {
    if (count > bestRoutingCount) {
      bestRoutingCount = count;
      bestRouting = r;
    }
  }

  // Sort component features by greedy stitch order, then stitch
  const ways = componentFeatures.map((f) => f.geometry.coordinates);
  const stitched = stitchWays(ways);

  return {
    type: "Feature",
    properties: { name: bestName, type: bestType, routing: bestRouting },
    geometry: { type: "LineString", coordinates: stitched },
  };
}

// ---------------------------------------------------------------------------
// Process one file
// ---------------------------------------------------------------------------

interface FileResult {
  filename: string;
  sizeMBBefore: number;
  sizeMBAfter: number;
  featuresBefore: number;
  featuresAfter: number;
  nodesBefore: number;
  nodesAfter: number;
  mergedFeatures: Feature[];
}

function processFile(filename: string): FileResult {
  const filepath = resolve(ROUTING_DIR, filename);
  const rawBefore = readFileSync(filepath, "utf8");
  const geojson = JSON.parse(rawBefore) as GeoJsonCollection;
  const features = geojson.features;

  const featuresBefore = features.length;
  const nodesBefore = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  const sizeMBBefore = statSync(filepath).size / 1_048_576;

  console.log(`\n  ${filename}`);
  console.log(
    `    Before: ${featuresBefore.toLocaleString()} features, ${nodesBefore.toLocaleString()} nodes`,
  );

  // Build proximity graph and find connected components
  const uf = buildProximityGraph(features, filename);
  const components = uf.components();

  // Merge each component
  const merged: Feature[] = [];
  for (const indices of components.values()) {
    const componentFeatures = indices.map((i) => features[i]);
    merged.push(mergeComponent(componentFeatures));
  }

  // Write back
  const collection: GeoJsonCollection = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    counts: {
      features: merged.length,
      nodes: merged.reduce((s, f) => s + f.geometry.coordinates.length, 0),
    },
    features: merged,
  };
  const json = JSON.stringify(collection);
  writeFileSync(filepath, json, "utf8");

  const featuresAfter = merged.length;
  const nodesAfter = merged.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  const sizeMBAfter = Buffer.byteLength(json, "utf8") / 1_048_576;

  console.log(
    `    After:  ${featuresAfter.toLocaleString()} features, ${nodesAfter.toLocaleString()} nodes`,
  );

  // Print any verify-names present in this file's output
  const featureByName = buildNameIndex(merged);
  for (const name of VERIFY_NAMES) {
    const f = featureByName.get(name);
    if (f) {
      const nodes = f.geometry.coordinates.length;
      const km = (polylineLength(f.geometry.coordinates) / 1000).toFixed(1);
      console.log(`    ${name}: ${nodes.toLocaleString()} nodes (${km} km)`);
    }
  }

  return {
    filename,
    sizeMBBefore,
    sizeMBAfter,
    featuresBefore,
    featuresAfter,
    nodesBefore,
    nodesAfter,
    mergedFeatures: merged,
  };
}

// ---------------------------------------------------------------------------
// Index merged features by name (largest by node count)
// ---------------------------------------------------------------------------

function buildNameIndex(features: Feature[]): Map<string, Feature> {
  const idx = new Map<string, Feature>();
  for (const f of features) {
    if (!f.properties.name) continue;
    const existing = idx.get(f.properties.name);
    if (!existing || f.geometry.coordinates.length > existing.geometry.coordinates.length) {
      idx.set(f.properties.name, f);
    }
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Verify Potomac specifically
// ---------------------------------------------------------------------------

function verifyPotomac(potomacFeatures: Feature[]): void {
  const featureByName = buildNameIndex(potomacFeatures);
  const potomac = featureByName.get("Potomac River");

  if (!potomac) {
    console.log("\n  ⚠ WARNING: 'Potomac River' named feature not found in potomac.geojson");
    return;
  }

  const nodes = potomac.geometry.coordinates.length;
  const km = polylineLength(potomac.geometry.coordinates) / 1000;
  const coords = potomac.geometry.coordinates;
  const lngs = coords.map(([lng]) => lng);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  console.log(`\n  Potomac River verification:`);
  console.log(`    Nodes:    ${nodes.toLocaleString()} (threshold: >500)`);
  console.log(`    Length:   ${km.toFixed(1)} km (threshold: >100 km)`);
  console.log(`    Lng span: ${minLng.toFixed(3)} → ${maxLng.toFixed(3)} (target: -77.8 → -76.8)`);

  const warnParts: string[] = [];
  if (nodes < 500) warnParts.push(`only ${nodes} nodes (expected >500)`);
  if (km < 100) warnParts.push(`only ${km.toFixed(1)} km (expected >100 km)`);
  if (maxLng - minLng < 0.5)
    warnParts.push(`lng span only ${(maxLng - minLng).toFixed(3)}° (expected ~1°)`);

  if (warnParts.length > 0) {
    console.log(
      `\n  ⚠ WARNING: Potomac may still be fragmented.\n    ${warnParts.join(", ")}\n    Check OSM data quality for this river.`,
    );
  } else {
    console.log(`    ✓ Potomac looks continuous`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const filenames = readdirSync(ROUTING_DIR)
    .filter((f) => f.endsWith(".geojson"))
    .sort();

  if (filenames.length === 0) {
    console.error(
      "No .geojson files found in data/routing/. Run optimize-waterways-routing.ts first.",
    );
    process.exit(1);
  }

  console.log(`Processing ${filenames.length} files in ${ROUTING_DIR}...`);

  let totalFeaturesBefore = 0;
  let totalFeaturesAfter = 0;
  let totalNodesBefore = 0;
  let totalNodesAfter = 0;

  const results: FileResult[] = [];
  let potomacFeatures: Feature[] = [];

  for (const filename of filenames) {
    const result = processFile(filename);
    results.push(result);
    totalFeaturesBefore += result.featuresBefore;
    totalFeaturesAfter += result.featuresAfter;
    totalNodesBefore += result.nodesBefore;
    totalNodesAfter += result.nodesAfter;
    if (filename === "potomac.geojson") {
      potomacFeatures = result.mergedFeatures;
    }
  }

  // Potomac specific verification
  verifyPotomac(potomacFeatures);

  // ---------------------------------------------------------------------------
  // Final summary
  // ---------------------------------------------------------------------------

  const reductionPct = (
    ((totalFeaturesBefore - totalFeaturesAfter) / totalFeaturesBefore) *
    100
  ).toFixed(1);

  console.log("\n=== Stitch Complete ===");
  console.log(
    `Total before: ${totalFeaturesBefore.toLocaleString()} features, ${totalNodesBefore.toLocaleString()} nodes`,
  );
  console.log(
    `Total after:  ${totalFeaturesAfter.toLocaleString()} features, ${totalNodesAfter.toLocaleString()} nodes  (${reductionPct}% feature reduction)`,
  );

  // File size table
  let totalAfterMB = 0;
  let totalBeforeMBKnown = 0;
  for (const r of results) {
    totalAfterMB += r.sizeMBAfter;
    totalBeforeMBKnown += Number(BEFORE_SIZE_MB[r.filename] ?? r.sizeMBBefore.toFixed(2));
  }

  console.log("\nFile sizes:");
  for (const r of results) {
    const wasMB = BEFORE_SIZE_MB[r.filename] ?? r.sizeMBBefore.toFixed(2);
    const nowMB = r.sizeMBAfter.toFixed(2);
    const label = `  ${r.filename}:`.padEnd(26);
    console.log(`${label} ${nowMB} MB  (was ${wasMB} MB)`);
  }
  console.log(
    `  TOTAL:                    ${totalAfterMB.toFixed(2)} MB  (was ${totalBeforeMBKnown.toFixed(2)} MB)`,
  );

  // Named waterway summary across all files
  const allMerged = results.flatMap((r) => r.mergedFeatures);
  const globalNameIndex = buildNameIndex(allMerged);

  console.log("\nNamed waterway node counts:");
  for (const name of VERIFY_NAMES) {
    const f = globalNameIndex.get(name);
    if (f) {
      const nodes = f.geometry.coordinates.length;
      const km = (polylineLength(f.geometry.coordinates) / 1000).toFixed(1);
      console.log(`  ${name.padEnd(32)} ${String(nodes).padStart(6)} nodes  (${km} km)`);
    } else {
      console.log(`  ${name.padEnd(32)} NOT FOUND`);
    }
  }
}

main();
