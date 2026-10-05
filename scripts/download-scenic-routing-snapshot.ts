/**
 * Download a resumable, tiled OSM/Overpass snapshot for scenic routing.
 *
 * The compiler needs complete OSM node/way/relation identity, so this script
 * stores raw Overpass JSON instead of converting it to GeoJSON. Small tiles
 * keep public Overpass requests bounded; duplicate boundary elements are
 * intentionally retained because the compiler merges them by OSM identity.
 *
 * Usage:
 *   npx tsx scripts/download-scenic-routing-snapshot.ts \
 *     --bbox 38.65,-77.5,39.15,-76.65 \
 *     --tile-degrees 0.25 \
 *     --version dmv-core-2026-07-18 \
 *     --output data/osm-water-routing.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildScenicRoutingOverpassQuery } from "./build-scenic-routing-graph";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  [key: string]: unknown;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  [key: string]: unknown;
}

interface Options {
  bbox: [number, number, number, number];
  tileDegrees: number;
  version: string;
  output: string;
  cacheDirectory: string;
  endpoints: string[];
}

const DEFAULT_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseBbox(raw: string): [number, number, number, number] {
  const values = raw.split(",").map(Number);
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isFinite(value)) ||
    values[0] >= values[2] ||
    values[1] >= values[3]
  ) {
    throw new Error("--bbox must be south,west,north,east");
  }
  return values as [number, number, number, number];
}

function parseOptions(): Options {
  const version = argument("--version") ?? new Date().toISOString().slice(0, 10);
  const tileDegrees = Number(argument("--tile-degrees") ?? "0.25");
  if (!Number.isFinite(tileDegrees) || tileDegrees <= 0 || tileDegrees > 1) {
    throw new Error("--tile-degrees must be greater than 0 and at most 1");
  }
  return {
    bbox: parseBbox(argument("--bbox") ?? "38.65,-77.5,39.15,-76.65"),
    tileDegrees,
    version,
    output: argument("--output") ?? "data/osm-water-routing.json",
    cacheDirectory: argument("--cache-directory") ?? `data/osm-routing-snapshot/${version}`,
    endpoints: (argument("--endpoints") ?? DEFAULT_ENDPOINTS.join(","))
      .split(",")
      .map((endpoint) => endpoint.trim())
      .filter(Boolean),
  };
}

function tiles(
  bbox: [number, number, number, number],
  tileDegrees: number,
): Array<[number, number, number, number]> {
  const [south, west, north, east] = bbox;
  const result: Array<[number, number, number, number]> = [];
  for (let tileSouth = south; tileSouth < north; tileSouth += tileDegrees) {
    for (let tileWest = west; tileWest < east; tileWest += tileDegrees) {
      result.push([
        tileSouth,
        tileWest,
        Math.min(north, tileSouth + tileDegrees),
        Math.min(east, tileWest + tileDegrees),
      ]);
    }
  }
  return result;
}

function tileName(tile: [number, number, number, number]): string {
  return tile.map((value) => value.toFixed(4).replaceAll("-", "m").replaceAll(".", "p")).join("_");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function downloadTile(
  tile: [number, number, number, number],
  endpoints: string[],
): Promise<OverpassResponse> {
  const query = buildScenicRoutingOverpassQuery(tile.join(","));
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const endpoint = endpoints[attempt % endpoints.length];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "User-Agent": "WaterWatchDMV-ScenicGraphBuilder/2.0",
        },
        body: query,
        signal: AbortSignal.timeout(240_000),
      });
      if (!response.ok) {
        const details = (await response.text()).slice(0, 500).replaceAll(/\s+/g, " ");
        throw new Error(`HTTP ${response.status}: ${details}`);
      }
      const payload = (await response.json()) as OverpassResponse;
      if (!Array.isArray(payload.elements)) throw new Error("response has no elements array");
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(5_000 * (attempt + 1));
    }
  }
  throw new Error(`Overpass tile ${tile.join(",")} failed: ${String(lastError)}`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const cacheDirectory = resolve(options.cacheDirectory);
  mkdirSync(cacheDirectory, { recursive: true });

  const allElements: OverpassElement[] = [];
  const snapshotTiles = tiles(options.bbox, options.tileDegrees);
  for (let index = 0; index < snapshotTiles.length; index++) {
    const tile = snapshotTiles[index];
    const cachePath = resolve(cacheDirectory, `${tileName(tile)}.json`);
    let payload: OverpassResponse;
    if (existsSync(cachePath)) {
      payload = JSON.parse(readFileSync(cachePath, "utf8")) as OverpassResponse;
      console.log(`[${index + 1}/${snapshotTiles.length}] reused ${tile.join(",")}`);
    } else {
      console.log(`[${index + 1}/${snapshotTiles.length}] downloading ${tile.join(",")}`);
      payload = await downloadTile(tile, options.endpoints);
      writeFileSync(cachePath, JSON.stringify(payload));
    }
    allElements.push(...(payload.elements ?? []));
  }

  const output = resolve(options.output);
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify({
      version: 0.6,
      generator: "WaterWatch DMV scenic routing snapshot builder",
      osm3s: {
        timestamp_osm_base: new Date().toISOString(),
        copyright: "The data included in this document is from www.openstreetmap.org.",
      },
      elements: allElements,
    }),
  );
  console.log(
    `Saved ${allElements.length.toLocaleString()} raw elements from ${snapshotTiles.length} tiles to ${output}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
