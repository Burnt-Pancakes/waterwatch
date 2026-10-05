/**
 * Compile an OSM Overpass JSON snapshot into versioned, topology-preserving
 * scenic-routing graph shards.
 *
 * Usage:
 *   npx tsx scripts/build-scenic-routing-graph.ts \
 *     --input data/osm-water-routing.json \
 *     --output data/routing-v2 \
 *     --version 2026-07-15
 *
 * Fetch the input out-of-band with the query printed by --print-query. The
 * compiler never joins waterways by name or proximity: OSM ways connect only
 * through shared node IDs, while synthetic open-water edges are accepted only
 * after polygon containment checks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  haversineMeters,
  isSegmentInsideWaterPolygon,
  type LngLat,
  type ScenicComponents,
  type ScenicGraph,
  type ScenicGraphConstraint,
  type ScenicGraphEdge,
  type ScenicGraphNode,
  type ScenicWaterPolygon,
} from "../supabase/functions/_shared/scenicRouting";

type OsmTags = Record<string, string>;

interface OsmGeometryPoint {
  lat: number;
  lon: number;
}

interface OsmMember {
  type: "node" | "way" | "relation";
  ref: number;
  role?: string;
}

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: OsmGeometryPoint;
  nodes?: number[];
  geometry?: OsmGeometryPoint[];
  members?: OsmMember[];
  tags?: OsmTags;
}

type WaterPolygon = ScenicWaterPolygon;

interface ContextFeature {
  point: LngLat;
  kind: "natural" | "interest" | "negative";
}

type ContextIndex = Map<string, ContextFeature[]>;

interface GraphManifest {
  schemaVersion: 1;
  dataVersion: string;
  generatedAt: string;
  source: string;
  attribution: string;
  cellSizeDegrees: number;
  shards: Array<{
    id: string;
    path: string;
    bbox: [number, number, number, number];
    nodeCount: number;
    edgeCount: number;
    polygonCount: number;
    constraintCount: number;
  }>;
}

const CELL_SIZE_DEG = 0.25;
const OPEN_WATER_SPACING_M = 75;
const OPEN_WATER_CLEARANCE_M = 10;
const MAX_OSM_SEGMENT_M = 100;
// Cloudflare Workers static assets currently allow at most 25 MiB per file.
// Keep one MiB of headroom for hosting/build changes.
const MAX_STATIC_ASSET_BYTES = 24 * 1024 * 1024;
const MIN_OPEN_WATER_AREA_M2 = 20_000;
const NATURAL_CONTEXT_M = 150;
const INTEREST_CONTEXT_M = 250;
const NEGATIVE_CONTEXT_M = 200;
const CONTEXT_CELL_DEG = 0.01;

const ROUTABLE_WATERWAYS = new Set([
  "river",
  "canal",
  "tidal_channel",
  "fairway",
  "link",
  "canoe_pass",
]);
const WATER_AREA_TYPES = new Set(["river", "canal", "lake", "reservoir", "bay"]);
const FORBIDDEN_ACCESS = new Set(["no", "private"]);
const ALLOWED_CANOE = new Set(["yes", "designated", "permissive"]);
const BARRIER_WATERWAYS = new Set(["dam", "weir", "waterfall", "lock_gate"]);

export function buildScenicRoutingOverpassQuery(bbox: string): string {
  return `
[out:json][timeout:180];
(
  way["waterway"~"^(river|stream|canal|tidal_channel|fairway|link)$"](${bbox});
  wr["natural"="water"]["water"~"^(river|canal|lake|reservoir|bay)$"](${bbox});
  nwr["waterway"~"^(dam|weir|waterfall|lock_gate|canoe_pass|rapids)$"](${bbox});
  nwr["hazard"](${bbox});
  relation["type"="route"]["route"="canoe"](${bbox});
)->.routing;
.routing out body geom;
(.routing; >;);
out skel qt;
(
  nwr["natural"~"^(wood|wetland|beach)$"](${bbox});
  nwr["leisure"~"^(park|nature_reserve)$"](${bbox});
  nwr["boundary"="protected_area"](${bbox});
  nwr["tourism"~"^(viewpoint|picnic_site|attraction)$"](${bbox});
  nwr["historic"](${bbox});
  nwr["landuse"~"^(industrial|commercial|retail)$"](${bbox});
  nwr["aeroway"](${bbox});
  nwr["highway"~"^(motorway|trunk)$"](${bbox});
  nwr["railway"="rail"](${bbox});
  nwr["man_made"="wastewater_plant"](${bbox});
)->.context;
.context out tags center;`.trim();
}

function parseArgs(): { input?: string; output: string; version: string; printQuery?: string } {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    input: value("--input"),
    output: value("--output") ?? "data/routing-v2",
    version: value("--version") ?? new Date().toISOString().slice(0, 10),
    printQuery: value("--print-query"),
  };
}

function coordinatesForWay(element: OsmElement, nodeCoordinates: Map<number, LngLat>): LngLat[] {
  if (element.nodes?.length) {
    const coordinates = element.nodes
      .map((id) => nodeCoordinates.get(id))
      .filter((point): point is LngLat => Boolean(point));
    if (coordinates.length === element.nodes.length) return coordinates;
  }
  return (element.geometry ?? []).map((point) => [point.lon, point.lat]);
}

function isClosed(coordinates: LngLat[]): boolean {
  if (coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: LngLat, polygon: WaterPolygon): boolean {
  return (
    pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))
  );
}

function distancePointToSegmentMeters(point: LngLat, a: LngLat, b: LngLat): number {
  const latitudeScale = Math.cos((point[1] * Math.PI) / 180);
  const px = point[0] * latitudeScale;
  const py = point[1];
  const ax = a[0] * latitudeScale;
  const ay = a[1];
  const bx = b[0] * latitudeScale;
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projected: LngLat = [(ax + t * dx) / latitudeScale, ay + t * dy];
  return haversineMeters(point, projected);
}

function distanceToPolygonBoundary(point: LngLat, polygon: WaterPolygon): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let index = 1; index < ring.length; index++) {
      best = Math.min(best, distancePointToSegmentMeters(point, ring[index - 1], ring[index]));
    }
  }
  return best;
}

function segmentInsidePolygon(a: LngLat, b: LngLat, polygon: WaterPolygon): boolean {
  return isSegmentInsideWaterPolygon(a, b, polygon);
}

function segmentHasClearance(
  a: LngLat,
  b: LngLat,
  polygon: WaterPolygon,
  clearanceMeters: number,
): boolean {
  const steps = Math.max(1, Math.ceil(haversineMeters(a, b) / 5));
  for (let index = 0; index <= steps; index++) {
    const fraction = index / steps;
    const point: LngLat = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    if (distanceToPolygonBoundary(point, polygon) < clearanceMeters) return false;
  }
  return true;
}

function polygonBounds(polygon: WaterPolygon): [number, number, number, number] {
  const lngs = polygon.outer.map((point) => point[0]);
  const lats = polygon.outer.map((point) => point[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function polygonAreaMeters2(ring: LngLat[]): number {
  const centerLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const xScale = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const yScale = 111_320;
  let area = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index];
    const b = ring[index + 1];
    area += a[0] * xScale * b[1] * yScale - b[0] * xScale * a[1] * yScale;
  }
  return Math.abs(area) / 2;
}

function averagePoint(coordinates: LngLat[]): LngLat {
  return [
    coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length,
    coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length,
  ];
}

function contextKind(tags: OsmTags): ContextFeature["kind"] | null {
  if (
    ["wood", "wetland", "beach"].includes(tags.natural) ||
    ["park", "nature_reserve"].includes(tags.leisure) ||
    tags.boundary === "protected_area"
  ) {
    return "natural";
  }
  if (["viewpoint", "picnic_site", "attraction"].includes(tags.tourism) || tags.historic) {
    return "interest";
  }
  if (
    ["industrial", "commercial", "retail"].includes(tags.landuse) ||
    tags.aeroway ||
    ["motorway", "trunk"].includes(tags.highway) ||
    tags.railway === "rail" ||
    tags.man_made === "wastewater_plant"
  ) {
    return "negative";
  }
  return null;
}

function proximityScore(
  point: LngLat,
  index: ContextIndex,
  kind: ContextFeature["kind"],
  max: number,
): number {
  let score = 0;
  const x = Math.floor(point[0] / CONTEXT_CELL_DEG);
  const y = Math.floor(point[1] / CONTEXT_CELL_DEG);
  for (let xOffset = -1; xOffset <= 1; xOffset++) {
    for (let yOffset = -1; yOffset <= 1; yOffset++) {
      for (const feature of index.get(`${x + xOffset}/${y + yOffset}`) ?? []) {
        if (feature.kind !== kind) continue;
        const distance = haversineMeters(point, feature.point);
        if (distance <= max) score = Math.max(score, 1 - distance / max);
      }
    }
  }
  return score;
}

function buildContextIndex(features: ContextFeature[]): ContextIndex {
  const index: ContextIndex = new Map();
  for (const feature of features) {
    const key = `${Math.floor(feature.point[0] / CONTEXT_CELL_DEG)}/${Math.floor(feature.point[1] / CONTEXT_CELL_DEG)}`;
    const cell = index.get(key) ?? [];
    cell.push(feature);
    index.set(key, cell);
  }
  return index;
}

function scenicForEdge(
  a: LngLat,
  b: LngLat,
  context: ContextIndex,
  tags: OsmTags = {},
  canoeRoute = false,
): ScenicComponents {
  const midpoint: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const natural = proximityScore(midpoint, context, "natural", NATURAL_CONTEXT_M);
  const interest = proximityScore(midpoint, context, "interest", INTEREST_CONTEXT_M);
  const negative = proximityScore(midpoint, context, "negative", NEGATIVE_CONTEXT_M);
  const canoeBonus = ALLOWED_CANOE.has(tags.canoe) || canoeRoute ? 1 : tags.name ? 0.35 : 0.1;
  return {
    natural,
    paddling: Math.max(canoeBonus, interest),
    quiet: Math.max(0, 1 - negative - (tags.waterway === "fairway" ? 0.4 : 0)),
  };
}

function assembleRings(ways: OsmElement[], nodeCoordinates: Map<number, LngLat>): LngLat[][] {
  const remaining = ways
    .filter((way) => (way.nodes?.length ?? 0) >= 2)
    .map((way) => [...way.nodes!]);
  const rings: LngLat[][] = [];

  while (remaining.length > 0) {
    const chain = remaining.shift()!;
    let changed = true;
    while (chain[0] !== chain[chain.length - 1] && changed) {
      changed = false;
      const end = chain[chain.length - 1];
      const matchIndex = remaining.findIndex(
        (candidate) => candidate[0] === end || candidate[candidate.length - 1] === end,
      );
      if (matchIndex >= 0) {
        const match = remaining.splice(matchIndex, 1)[0];
        if (match[match.length - 1] === end) match.reverse();
        chain.push(...match.slice(1));
        changed = true;
      }
    }
    if (chain[0] !== chain[chain.length - 1]) continue;
    const coordinates = chain
      .map((nodeId) => nodeCoordinates.get(nodeId))
      .filter((point): point is LngLat => Boolean(point));
    if (coordinates.length === chain.length && coordinates.length >= 4) rings.push(coordinates);
  }
  return rings;
}

function buildWaterPolygons(
  elements: OsmElement[],
  wayById: Map<number, OsmElement>,
  nodeCoordinates: Map<number, LngLat>,
): WaterPolygon[] {
  const polygons: WaterPolygon[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (tags.natural !== "water" || !WATER_AREA_TYPES.has(tags.water)) continue;
    if (element.type === "way") {
      const outer = coordinatesForWay(element, nodeCoordinates);
      if (isClosed(outer)) polygons.push({ id: `way/${element.id}`, outer, holes: [] });
      continue;
    }
    if (element.type !== "relation" || tags.type !== "multipolygon") continue;
    const outerWays = (element.members ?? [])
      .filter((member) => member.type === "way" && member.role !== "inner")
      .map((member) => wayById.get(member.ref))
      .filter((way): way is OsmElement => Boolean(way));
    const innerWays = (element.members ?? [])
      .filter((member) => member.type === "way" && member.role === "inner")
      .map((member) => wayById.get(member.ref))
      .filter((way): way is OsmElement => Boolean(way));
    const outers = assembleRings(outerWays, nodeCoordinates);
    const inners = assembleRings(innerWays, nodeCoordinates);
    for (let index = 0; index < outers.length; index++) {
      const outer = outers[index];
      polygons.push({
        id: `relation/${element.id}/${index}`,
        outer,
        holes: inners.filter((inner) => pointInRing(inner[0], outer)),
      });
    }
  }
  return polygons;
}

function orientation(a: LngLat, b: LngLat, c: LngLat): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cross) < 1e-12) return 0;
  return Math.sign(cross);
}

function pointOnSegment(point: LngLat, a: LngLat, b: LngLat): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    point[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-12 &&
    point[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d))
  );
}

function mergeDuplicateElements(elements: OsmElement[]): OsmElement[] {
  const merged = new Map<string, OsmElement>();
  for (const element of elements) {
    const key = `${element.type}/${element.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, element);
      continue;
    }
    merged.set(key, {
      type: element.type,
      id: element.id,
      lat: element.lat ?? existing.lat,
      lon: element.lon ?? existing.lon,
      center: element.center ?? existing.center,
      nodes:
        (element.nodes?.length ?? 0) >= (existing.nodes?.length ?? 0)
          ? element.nodes
          : existing.nodes,
      geometry:
        (element.geometry?.length ?? 0) >= (existing.geometry?.length ?? 0)
          ? element.geometry
          : existing.geometry,
      members:
        (element.members?.length ?? 0) >= (existing.members?.length ?? 0)
          ? element.members
          : existing.members,
      tags: { ...(existing.tags ?? {}), ...(element.tags ?? {}) },
    });
  }
  return [...merged.values()];
}

function addDirectedPair(
  edges: ScenicGraphEdge[],
  edge: Omit<ScenicGraphEdge, "id" | "from" | "to"> & { baseId: string; from: string; to: string },
): void {
  const { baseId, from, to, ...properties } = edge;
  edges.push(
    { id: `${baseId}:f`, from, to, ...properties },
    { id: `${baseId}:r`, from: to, to: from, ...properties },
  );
}

export function buildGraph(elements: OsmElement[], version: string): ScenicGraph {
  elements = mergeDuplicateElements(elements);
  const nodeCoordinates = new Map<number, LngLat>();
  for (const element of elements) {
    if (element.type === "node" && element.lon != null && element.lat != null) {
      nodeCoordinates.set(element.id, [element.lon, element.lat]);
    }
    if (element.type === "way" && element.nodes && element.geometry) {
      element.nodes.forEach((nodeId, index) => {
        const point = element.geometry?.[index];
        if (point) nodeCoordinates.set(nodeId, [point.lon, point.lat]);
      });
    }
  }

  const wayById = new Map(
    elements.filter((element) => element.type === "way").map((element) => [element.id, element]),
  );
  const canoeRouteWays = new Set<number>();
  const wayRelationIds = new Map<number, number[]>();
  for (const relation of elements.filter((element) => element.type === "relation")) {
    for (const member of relation.members ?? []) {
      if (member.type !== "way") continue;
      const memberships = wayRelationIds.get(member.ref) ?? [];
      memberships.push(relation.id);
      wayRelationIds.set(member.ref, memberships);
    }
  }
  for (const relation of elements.filter(
    (element) =>
      element.type === "relation" &&
      element.tags?.type === "route" &&
      element.tags.route === "canoe",
  )) {
    for (const member of relation.members ?? []) {
      if (member.type === "way") canoeRouteWays.add(member.ref);
    }
  }

  const constraints: ScenicGraphConstraint[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const canoeExplicitlyAllowed = ALLOWED_CANOE.has(tags.canoe);
    let kind: ScenicGraphConstraint["kind"] | null = null;
    let reason = "";
    if (BARRIER_WATERWAYS.has(tags.waterway)) {
      kind = "barrier";
      reason = `Uncrossable ${tags.waterway}`;
    } else if (tags.hazard || tags.waterway === "rapids") {
      kind = "hazard";
      reason = tags.hazard ?? "rapids";
    } else if (FORBIDDEN_ACCESS.has(tags.canoe)) {
      kind = "restriction";
      reason = `canoe=${tags.canoe}`;
    } else if (
      !canoeExplicitlyAllowed &&
      (FORBIDDEN_ACCESS.has(tags.access) || FORBIDDEN_ACCESS.has(tags.boat))
    ) {
      kind = "restriction";
      reason = FORBIDDEN_ACCESS.has(tags.access) ? `access=${tags.access}` : `boat=${tags.boat}`;
    } else if (tags.intermittent === "yes" || (Boolean(tags.seasonal) && tags.seasonal !== "no")) {
      kind = "restriction";
      reason = tags.intermittent === "yes" ? "intermittent=yes" : `seasonal=${tags.seasonal}`;
    } else if (tags.tunnel || tags.covered === "yes") {
      kind = "restriction";
      reason = tags.tunnel ? `tunnel=${tags.tunnel}` : "covered=yes";
    } else if (tags.lock === "yes") {
      kind = "barrier";
      reason = "lock=yes";
    }
    if (!kind) continue;

    const geometry =
      element.type === "node" && element.lon != null && element.lat != null
        ? ([[element.lon, element.lat]] as LngLat[])
        : element.type === "relation"
          ? (element.members ?? [])
              .filter((member) => member.type === "way")
              .flatMap((member) => {
                const way = wayById.get(member.ref);
                return way ? coordinatesForWay(way, nodeCoordinates) : [];
              })
          : coordinatesForWay(element, nodeCoordinates);
    constraints.push({
      id: `${kind}/${element.type}/${element.id}`,
      kind,
      osmType: element.type,
      osmId: element.id,
      nodeIds: element.type === "node" ? [element.id] : [...(element.nodes ?? [])],
      relationIds:
        element.type === "way"
          ? [...(wayRelationIds.get(element.id) ?? [])].sort((left, right) => left - right)
          : [],
      geometry,
      tags: { ...tags },
      reason,
    });
  }

  const context: ContextFeature[] = [];
  for (const element of elements) {
    const kind = contextKind(element.tags ?? {});
    if (!kind) continue;
    const coordinates =
      element.type === "node" && element.lon != null && element.lat != null
        ? ([[element.lon, element.lat]] as LngLat[])
        : element.center
          ? ([[element.center.lon, element.center.lat]] as LngLat[])
          : coordinatesForWay(element, nodeCoordinates);
    if (coordinates.length) context.push({ point: averagePoint(coordinates), kind });
  }
  const contextIndex = buildContextIndex(context);

  const canoePassNodes = new Set(
    elements
      .filter((element) => element.type === "node" && element.tags?.waterway === "canoe_pass")
      .map((element) => element.id),
  );
  const barrierNodes = new Set(
    elements
      .filter(
        (element) => element.type === "node" && BARRIER_WATERWAYS.has(element.tags?.waterway ?? ""),
      )
      .map((element) => element.id),
  );
  const hazardsByNode = new Map<number, Set<string>>();
  for (const element of elements) {
    const tags = element.tags ?? {};
    const hazard = tags.hazard ?? (tags.waterway === "rapids" ? "rapids" : undefined);
    if (!hazard) continue;
    const nodeIds = element.type === "node" ? [element.id] : (element.nodes ?? []);
    for (const nodeId of nodeIds) {
      const hazards = hazardsByNode.get(nodeId) ?? new Set<string>();
      hazards.add(hazard);
      hazardsByNode.set(nodeId, hazards);
    }
  }
  const barrierSegments: Array<[LngLat, LngLat]> = [];
  for (const way of elements.filter(
    (element) => element.type === "way" && BARRIER_WATERWAYS.has(element.tags?.waterway ?? ""),
  )) {
    const coordinates = coordinatesForWay(way, nodeCoordinates);
    for (let index = 1; index < coordinates.length; index++) {
      barrierSegments.push([coordinates[index - 1], coordinates[index]]);
    }
  }

  const nodes = new Map<string, ScenicGraphNode>();
  const edges: ScenicGraphEdge[] = [];
  for (const way of elements.filter((element) => element.type === "way")) {
    const tags = way.tags ?? {};
    const isCanoeRoute = canoeRouteWays.has(way.id);
    const isCanoePass = tags.waterway === "canoe_pass";
    const canoeExplicitlyAllowed = ALLOWED_CANOE.has(tags.canoe);
    const routeStream = tags.waterway === "stream" && (canoeExplicitlyAllowed || isCanoeRoute);
    if (!ROUTABLE_WATERWAYS.has(tags.waterway) && !routeStream) continue;
    if (
      FORBIDDEN_ACCESS.has(tags.canoe) ||
      (!canoeExplicitlyAllowed &&
        (FORBIDDEN_ACCESS.has(tags.access) || FORBIDDEN_ACCESS.has(tags.boat))) ||
      tags.intermittent === "yes" ||
      (Boolean(tags.seasonal) && tags.seasonal !== "no") ||
      tags.tunnel ||
      tags.covered === "yes" ||
      (tags.lock === "yes" && !isCanoePass)
    ) {
      continue;
    }
    const nodeIds = way.nodes ?? [];
    const coordinates = coordinatesForWay(way, nodeCoordinates);
    if (nodeIds.length !== coordinates.length) continue;
    for (let index = 1; index < nodeIds.length; index++) {
      const fromNode = nodeIds[index - 1];
      const toNode = nodeIds[index];
      if (
        !isCanoePass &&
        ((barrierNodes.has(fromNode) && !canoePassNodes.has(fromNode)) ||
          (barrierNodes.has(toNode) && !canoePassNodes.has(toNode)))
      ) {
        continue;
      }
      const a = coordinates[index - 1];
      const b = coordinates[index];
      if (!isCanoePass && barrierSegments.some(([c, d]) => segmentsIntersect(a, b, c, d))) {
        continue;
      }
      const sourceDistance = haversineMeters(a, b);
      if (sourceDistance <= 0) continue;
      const partCount = Math.max(1, Math.ceil(sourceDistance / MAX_OSM_SEGMENT_M));
      const segmentNodes: Array<{ id: string; coordinate: LngLat }> = [];
      for (let part = 0; part <= partCount; part++) {
        const fraction = part / partCount;
        const coordinate: LngLat = [
          a[0] + (b[0] - a[0]) * fraction,
          a[1] + (b[1] - a[1]) * fraction,
        ];
        const id =
          part === 0
            ? `osm/${fromNode}`
            : part === partCount
              ? `osm/${toNode}`
              : `osm-segment/${way.id}/${index - 1}/${part}`;
        nodes.set(id, { id, lng: coordinate[0], lat: coordinate[1] });
        segmentNodes.push({ id, coordinate });
      }
      const hazards = [
        ...new Set([...(hazardsByNode.get(fromNode) ?? []), ...(hazardsByNode.get(toNode) ?? [])]),
      ];
      for (let part = 1; part < segmentNodes.length; part++) {
        const from = segmentNodes[part - 1];
        const to = segmentNodes[part];
        addDirectedPair(edges, {
          baseId: `osm-way/${way.id}/${index - 1}/${part - 1}`,
          from: from.id,
          to: to.id,
          distanceMeters: haversineMeters(from.coordinate, to.coordinate),
          provenance: "osm_waterway",
          osmWayId: way.id,
          osmNodeIds: [fromNode, toNode],
          relationIds: [...(wayRelationIds.get(way.id) ?? [])].sort((left, right) => left - right),
          access: {
            access: tags.access,
            canoe: tags.canoe,
            boat: tags.boat,
          },
          hazards,
          waterwayType: tags.waterway,
          waterwayName: tags.name,
          scenic: scenicForEdge(
            from.coordinate,
            to.coordinate,
            contextIndex,
            tags,
            isCanoeRoute || isCanoePass,
          ),
        });
      }
    }
  }

  const waterPolygons = buildWaterPolygons(elements, wayById, nodeCoordinates);
  for (const polygon of waterPolygons) {
    if (polygonAreaMeters2(polygon.outer) < MIN_OPEN_WATER_AREA_M2) continue;
    const [west, south, east, north] = polygonBounds(polygon);
    const centerLat = (south + north) / 2;
    const latStep = (OPEN_WATER_SPACING_M * Math.sqrt(3)) / 2 / 111_320;
    const lngStep = OPEN_WATER_SPACING_M / (111_320 * Math.cos((centerLat * Math.PI) / 180));
    const grid = new Map<string, ScenicGraphNode>();
    let row = 0;
    for (let lat = south; lat <= north; lat += latStep, row++) {
      const offset = row % 2 === 0 ? 0 : lngStep / 2;
      let column = 0;
      for (let lng = west + offset; lng <= east; lng += lngStep, column++) {
        const point: LngLat = [lng, lat];
        if (!pointInPolygon(point, polygon)) continue;
        if (distanceToPolygonBoundary(point, polygon) < OPEN_WATER_CLEARANCE_M) continue;
        const id = `water/${polygon.id}/${row}/${column}`;
        const node = { id, lng, lat };
        grid.set(`${row}/${column}`, node);
        nodes.set(id, node);
      }
    }

    const neighborKeys = (rowIndex: number, columnIndex: number): string[] => [
      `${rowIndex}/${columnIndex - 1}`,
      `${rowIndex - 1}/${columnIndex}`,
      `${rowIndex - 1}/${columnIndex + (rowIndex % 2 === 0 ? -1 : 1)}`,
    ];
    for (const [key, node] of grid) {
      const [rowIndex, columnIndex] = key.split("/").map(Number);
      for (const neighborKey of neighborKeys(rowIndex, columnIndex)) {
        const neighbor = grid.get(neighborKey);
        if (!neighbor) continue;
        const a: LngLat = [node.lng, node.lat];
        const b: LngLat = [neighbor.lng, neighbor.lat];
        if (!segmentInsidePolygon(a, b, polygon)) continue;
        if (!segmentHasClearance(a, b, polygon, OPEN_WATER_CLEARANCE_M)) continue;
        addDirectedPair(edges, {
          baseId: `open/${polygon.id}/${key}/${neighborKey}`,
          from: node.id,
          to: neighbor.id,
          distanceMeters: haversineMeters(a, b),
          provenance: "open_water",
          waterPolygonId: polygon.id,
          validatedWater: true,
          scenic: scenicForEdge(a, b, contextIndex),
        });
      }
    }

    const gridNodes = [...grid.values()];
    for (const osmNode of [...nodes.values()].filter((node) => node.id.startsWith("osm/"))) {
      const point: LngLat = [osmNode.lng, osmNode.lat];
      if (!pointInPolygon(point, polygon)) continue;
      let nearest: ScenicGraphNode | null = null;
      let nearestDistance = 150;
      for (const gridNode of gridNodes) {
        const distance = haversineMeters(point, [gridNode.lng, gridNode.lat]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = gridNode;
        }
      }
      if (!nearest) continue;
      const target: LngLat = [nearest.lng, nearest.lat];
      if (!segmentInsidePolygon(point, target, polygon)) continue;
      addDirectedPair(edges, {
        baseId: `connector/${polygon.id}/${osmNode.id}/${nearest.id}`,
        from: osmNode.id,
        to: nearest.id,
        distanceMeters: nearestDistance,
        provenance: "open_water",
        waterPolygonId: polygon.id,
        validatedWater: true,
        scenic: scenicForEdge(point, target, contextIndex),
      });
    }
  }

  return {
    dataVersion: version,
    nodes: [...nodes.values()],
    edges,
    waterPolygons,
    constraints,
  };
}

export function validateCompiledGraph(graph: ScenicGraph): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const nodeById = new Map<string, ScenicGraphNode>();
  const edgeIds = new Set<string>();
  const polygonById = new Map((graph.waterPolygons ?? []).map((polygon) => [polygon.id, polygon]));
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) errors.push(`Duplicate node ID: ${node.id}`);
    nodeIds.add(node.id);
    nodeById.set(node.id, node);
    if (!Number.isFinite(node.lng) || !Number.isFinite(node.lat)) {
      errors.push(`Invalid node coordinate: ${node.id}`);
    }
  }
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge ID: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push(`Edge endpoint missing: ${edge.id}`);
    }
    if (!Number.isFinite(edge.distanceMeters) || edge.distanceMeters <= 0) {
      errors.push(`Invalid edge distance: ${edge.id}`);
    }
    if (edge.provenance === "open_water" && (!edge.waterPolygonId || !edge.validatedWater)) {
      errors.push(`Unvalidated open-water edge: ${edge.id}`);
    }
    if (edge.provenance === "open_water" && edge.waterPolygonId) {
      const polygon = polygonById.get(edge.waterPolygonId);
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!polygon) {
        errors.push(`Open-water edge lacks source polygon: ${edge.id}`);
      } else if (
        from &&
        to &&
        !isSegmentInsideWaterPolygon([from.lng, from.lat], [to.lng, to.lat], polygon)
      ) {
        errors.push(`Open-water edge crosses land: ${edge.id}`);
      }
    }
    if (edge.provenance === "osm_waterway" && !edge.id.startsWith("osm-way/")) {
      errors.push(`OSM edge lacks way provenance: ${edge.id}`);
    }
    if (edge.provenance === "osm_waterway" && (edge.osmWayId == null || !edge.osmNodeIds)) {
      errors.push(`OSM edge lacks source IDs: ${edge.id}`);
    }
  }
  const constraintIds = new Set<string>();
  for (const constraint of graph.constraints ?? []) {
    if (constraintIds.has(constraint.id)) errors.push(`Duplicate constraint ID: ${constraint.id}`);
    constraintIds.add(constraint.id);
    if (constraint.geometry.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat))) {
      errors.push(`Invalid constraint geometry: ${constraint.id}`);
    }
  }
  return errors;
}

function cellId(lng: number, lat: number): string {
  const x = Math.floor((lng + 180) / CELL_SIZE_DEG);
  const y = Math.floor((lat + 90) / CELL_SIZE_DEG);
  return `${x}-${y}`;
}

function cellBounds(id: string): [number, number, number, number] {
  const [x, y] = id.split("-").map(Number);
  const west = x * CELL_SIZE_DEG - 180;
  const south = y * CELL_SIZE_DEG - 90;
  return [west, south, west + CELL_SIZE_DEG, south + CELL_SIZE_DEG];
}

function writeShards(graph: ScenicGraph, output: string): GraphManifest {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeCells = new Map<string, ScenicGraphEdge[]>();
  for (const edge of graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    for (const id of new Set([cellId(from.lng, from.lat), cellId(to.lng, to.lat)])) {
      const list = edgeCells.get(id) ?? [];
      list.push(edge);
      edgeCells.set(id, list);
    }
  }
  const constraintCells = new Map<string, ScenicGraphConstraint[]>();
  for (const constraint of graph.constraints ?? []) {
    for (const id of new Set(constraint.geometry.map(([lng, lat]) => cellId(lng, lat)))) {
      const list = constraintCells.get(id) ?? [];
      list.push(constraint);
      constraintCells.set(id, list);
    }
  }
  const polygonById = new Map((graph.waterPolygons ?? []).map((polygon) => [polygon.id, polygon]));

  const shardDirectory = resolve(output, graph.dataVersion, "shards");
  mkdirSync(shardDirectory, { recursive: true });
  const shards: GraphManifest["shards"] = [];
  const shardIds = [...new Set([...edgeCells.keys(), ...constraintCells.keys()])].sort();
  for (const id of shardIds) {
    const edges = edgeCells.get(id) ?? [];
    const nodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const polygonIds = new Set(
      edges
        .filter((edge) => edge.provenance === "open_water")
        .map((edge) => edge.waterPolygonId)
        .filter((polygonId): polygonId is string => Boolean(polygonId)),
    );
    const constraints = constraintCells.get(id) ?? [];
    const shard: ScenicGraph = {
      dataVersion: graph.dataVersion,
      nodes: [...nodeIds].map((nodeId) => nodeById.get(nodeId)!).filter(Boolean),
      edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
      waterPolygons: [...polygonIds]
        .map((polygonId) => polygonById.get(polygonId)!)
        .filter(Boolean),
      constraints,
    };
    const shardErrors = validateCompiledGraph(shard);
    if (shardErrors.length > 0) {
      throw new Error(`Routing shard ${id} is invalid:\n${shardErrors.slice(0, 25).join("\n")}`);
    }
    const filename = `${id}.json`;
    const serialized = JSON.stringify(shard);
    const shardBytes = Buffer.byteLength(serialized);
    if (shardBytes > MAX_STATIC_ASSET_BYTES) {
      throw new Error(
        `Routing shard ${id} is ${(shardBytes / 1024 / 1024).toFixed(1)} MiB; reduce CELL_SIZE_DEG before publishing (24 MiB limit).`,
      );
    }
    writeFileSync(resolve(shardDirectory, filename), serialized);
    shards.push({
      id,
      path: `shards/${filename}`,
      bbox: cellBounds(id),
      nodeCount: shard.nodes.length,
      edgeCount: shard.edges.length,
      polygonCount: shard.waterPolygons?.length ?? 0,
      constraintCount: constraints.length,
    });
  }

  const manifest: GraphManifest = {
    schemaVersion: 1,
    dataVersion: graph.dataVersion,
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap / Overpass snapshot",
    attribution: "© OpenStreetMap contributors",
    cellSizeDegrees: CELL_SIZE_DEG,
    shards,
  };
  const versionDirectory = resolve(output, graph.dataVersion);
  writeFileSync(resolve(versionDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function main(): void {
  const args = parseArgs();
  if (args.printQuery) {
    console.log(buildScenicRoutingOverpassQuery(args.printQuery));
    return;
  }
  if (!args.input) {
    throw new Error("--input is required (or use --print-query south,west,north,east)");
  }
  const response = JSON.parse(readFileSync(resolve(args.input), "utf8")) as {
    elements?: OsmElement[];
  };
  const versionDirectory = resolve(args.output, args.version);
  if (existsSync(versionDirectory)) {
    throw new Error(
      `Routing data version ${args.version} already exists at ${versionDirectory}; choose a new immutable version.`,
    );
  }
  const elements = response.elements ?? [];
  const graph = buildGraph(elements, args.version);
  const validationErrors = validateCompiledGraph(graph);
  if (validationErrors.length > 0) {
    throw new Error(
      `Routing graph validation failed:\n${validationErrors.slice(0, 25).join("\n")}`,
    );
  }
  const manifest = writeShards(graph, resolve(args.output));
  console.log(
    `Built ${graph.nodes.length.toLocaleString()} nodes, ${graph.edges.length.toLocaleString()} directed edges, and ${manifest.shards.length.toLocaleString()} shards for ${args.version}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
