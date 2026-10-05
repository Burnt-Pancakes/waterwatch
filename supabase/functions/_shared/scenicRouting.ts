/**
 * Pure topology-preserving routing primitives shared by the graph compiler,
 * tests, and the same-origin scenic route server API.
 *
 * Graph edges are accepted only when the offline compiler can prove that they
 * are original OSM waterway segments or validated open-water connections.
 */

export type LngLat = [number, number];

export type RouteErrorCode = "WAYPOINT_OFF_NETWORK" | "NO_WATER_ROUTE" | "ROUTE_VALIDATION_FAILED";

export type EdgeProvenance = "osm_waterway" | "open_water";

export interface ScenicComponents {
  natural: number;
  paddling: number;
  quiet: number;
}

export interface ScenicGraphNode {
  id: string;
  lng: number;
  lat: number;
}

export interface ScenicWaterPolygon {
  id: string;
  outer: LngLat[];
  holes: LngLat[][];
}

export interface ScenicGraphConstraint {
  id: string;
  kind: "barrier" | "restriction" | "hazard";
  osmType: "node" | "way" | "relation";
  osmId: number;
  nodeIds: number[];
  relationIds: number[];
  geometry: LngLat[];
  tags: Record<string, string>;
  reason: string;
}

export interface ScenicGraphEdge {
  id: string;
  from: string;
  to: string;
  distanceMeters: number;
  provenance: EdgeProvenance;
  waterwayType?: string;
  waterwayName?: string;
  waterPolygonId?: string;
  validatedWater?: boolean;
  /** Original OSM provenance retained for audit and fail-closed validation. */
  osmWayId?: number;
  osmNodeIds?: [number, number];
  relationIds?: number[];
  access?: {
    access?: string;
    canoe?: string;
    boat?: string;
  };
  hazards?: string[];
  scenic: ScenicComponents;
}

export interface ScenicGraph {
  dataVersion: string;
  nodes: ScenicGraphNode[];
  /** Directed edges. Bidirectional water travel is represented by two edges. */
  edges: ScenicGraphEdge[];
  /** Original OSM water geometry used to revalidate synthetic edges at request time. */
  waterPolygons?: ScenicWaterPolygon[];
  /** Excluded barriers/restrictions and non-blocking hazards retained for audit. */
  constraints?: ScenicGraphConstraint[];
}

export interface ScenicRouteWaypoint {
  lng: number;
  lat: number;
  siteId?: string;
  name?: string;
}

export interface ScenicRouteLeg {
  fromIndex: number;
  toIndex: number;
  coordinates: LngLat[];
  distanceMeters: number;
  scenicScore: number;
  snapDistancesMeters: [number, number];
  accessConnectors: LngLat[][];
  waterProvenance: "osm_centerline" | "open_water" | "mixed";
  waterSources: Array<{
    provenance: EdgeProvenance;
    osmWayId?: number;
    osmNodeIds?: number[];
    relationIds?: number[];
    waterPolygonId?: string;
    waterwayType?: string;
    waterwayName?: string;
  }>;
  scenicHighlights: string[];
  warnings: string[];
  candidateCount: number;
}

export interface ScenicRouteResult {
  dataVersion: string;
  profile: "scenic_water";
  coordinates: LngLat[];
  distanceMeters: number;
  scenicScore: number;
  scenicHighlights: string[];
  warnings: string[];
  legs: ScenicRouteLeg[];
}

export interface ScenicRouteOptions {
  maxSnapMeters?: number;
  maxDetourRatio?: number;
  maxCandidates?: number;
}

export interface ScenicRouteRequest {
  waypoints: ScenicRouteWaypoint[];
  maxDetourRatio: number;
}

/** Strict API boundary validation shared with the Edge Function tests. */
export function parseScenicRouteRequest(value: unknown): ScenicRouteRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.profile !== "scenic_water") return null;
  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2 || body.waypoints.length > 8) {
    return null;
  }

  const waypoints: ScenicRouteWaypoint[] = [];
  for (const raw of body.waypoints) {
    if (!raw || typeof raw !== "object") return null;
    const waypoint = raw as Record<string, unknown>;
    if (
      typeof waypoint.lng !== "number" ||
      typeof waypoint.lat !== "number" ||
      !Number.isFinite(waypoint.lng) ||
      !Number.isFinite(waypoint.lat) ||
      waypoint.lng < -180 ||
      waypoint.lng > 180 ||
      waypoint.lat < -90 ||
      waypoint.lat > 90
    ) {
      return null;
    }
    waypoints.push({
      lng: waypoint.lng,
      lat: waypoint.lat,
      siteId:
        typeof waypoint.siteId === "string" && waypoint.siteId.length <= 200
          ? waypoint.siteId
          : undefined,
      name:
        typeof waypoint.name === "string" && waypoint.name.length <= 200
          ? waypoint.name
          : undefined,
    });
  }

  if (
    body.maxDetourRatio != null &&
    (typeof body.maxDetourRatio !== "number" || !Number.isFinite(body.maxDetourRatio))
  ) {
    return null;
  }
  const requestedDetour = (body.maxDetourRatio as number | undefined) ?? 1.35;
  return { waypoints, maxDetourRatio: Math.max(1, Math.min(1.35, requestedDetour)) };
}

export interface ScenicRouteDiagnostics {
  snapDistancesMeters?: number[];
  candidateCount?: number;
  validationResult?: "passed" | "failed" | "not_run";
}

export class ScenicRouteError extends Error {
  constructor(
    public readonly code: RouteErrorCode,
    public readonly legIndex: number,
    message: string,
    public readonly diagnostics: ScenicRouteDiagnostics = {},
  ) {
    super(message);
    this.name = "ScenicRouteError";
  }
}

interface IndexedGraph {
  graph: ScenicGraph;
  nodes: Map<string, ScenicGraphNode>;
  edges: Map<string, ScenicGraphEdge>;
  adjacency: Map<string, ScenicGraphEdge[]>;
  waterPolygons: Map<string, ScenicWaterPolygon>;
  componentByNode: Map<string, number>;
}

// Compiled graph objects are immutable for the lifetime of a route request
// service. Reusing their topology index keeps subsequent (warm) routes from
// rebuilding maps and connected components for tens of thousands of nodes.
const indexedGraphCache = new WeakMap<ScenicGraph, IndexedGraph>();

interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  distanceMeters: number;
}

interface ScoredPath extends GraphPath {
  scenicScore: number;
  utility: number;
  highlights: string[];
  warnings: string[];
}

const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_MAX_SNAP_METERS = 250;
const DEFAULT_MAX_DETOUR_RATIO = 1.35;
const DEFAULT_MAX_CANDIDATES = 20;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
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

export function isSegmentInsideWaterPolygon(
  a: LngLat,
  b: LngLat,
  polygon: ScenicWaterPolygon,
): boolean {
  const inside = (point: LngLat) =>
    pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole));
  if (!inside(a) || !inside(b)) return false;
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let index = 1; index < ring.length; index++) {
      if (segmentsIntersect(a, b, ring[index - 1], ring[index])) return false;
    }
  }
  const distance = haversineMeters(a, b);
  const steps = Math.max(1, Math.ceil(distance / 10));
  for (let index = 1; index < steps; index++) {
    const fraction = index / steps;
    if (!inside([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction])) {
      return false;
    }
  }
  return true;
}

function indexGraph(graph: ScenicGraph): IndexedGraph {
  const cached = indexedGraphCache.get(graph);
  if (cached) return cached;

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map<string, ScenicGraphEdge>();
  const adjacency = new Map<string, ScenicGraphEdge[]>();

  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    edges.set(edge.id, edge);
    const outgoing = adjacency.get(edge.from) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.from, outgoing);
  }

  for (const outgoing of adjacency.values()) {
    outgoing.sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  }

  const undirected = new Map<string, Set<string>>();
  for (const nodeId of nodes.keys()) undirected.set(nodeId, new Set());
  for (const edge of edges.values()) {
    undirected.get(edge.from)?.add(edge.to);
    undirected.get(edge.to)?.add(edge.from);
  }
  const componentByNode = new Map<string, number>();
  let component = 0;
  for (const nodeId of nodes.keys()) {
    if (componentByNode.has(nodeId)) continue;
    const pending = [nodeId];
    componentByNode.set(nodeId, component);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of undirected.get(current) ?? []) {
        if (componentByNode.has(neighbor)) continue;
        componentByNode.set(neighbor, component);
        pending.push(neighbor);
      }
    }
    component += 1;
  }

  const indexed = {
    graph,
    nodes,
    edges,
    adjacency,
    waterPolygons: new Map((graph.waterPolygons ?? []).map((polygon) => [polygon.id, polygon])),
    componentByNode,
  };
  indexedGraphCache.set(graph, indexed);
  return indexed;
}

class MinHeap<T> {
  private readonly values: Array<{ priority: number; tie: string; value: T }> = [];

  push(value: T, priority: number, tie: string): void {
    this.values.push({ value, priority, tie });
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(index, parent)) break;
      [this.values[index], this.values[parent]] = [this.values[parent], this.values[index]];
      index = parent;
    }
  }

  pop(): T | undefined {
    if (this.values.length === 0) return undefined;
    const first = this.values[0].value;
    const last = this.values.pop();
    if (this.values.length > 0 && last) {
      this.values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.values.length && this.less(left, smallest)) smallest = left;
        if (right < this.values.length && this.less(right, smallest)) smallest = right;
        if (smallest === index) break;
        [this.values[index], this.values[smallest]] = [this.values[smallest], this.values[index]];
        index = smallest;
      }
    }
    return first;
  }

  get size(): number {
    return this.values.length;
  }

  private less(a: number, b: number): boolean {
    const left = this.values[a];
    const right = this.values[b];
    return (
      left.priority < right.priority || (left.priority === right.priority && left.tie < right.tie)
    );
  }
}

function aStar(
  graph: IndexedGraph,
  startId: string,
  endId: string,
  bannedEdgeIds: Set<string> = new Set(),
  bannedNodeIds: Set<string> = new Set(),
  maxDistanceMeters = Number.POSITIVE_INFINITY,
): GraphPath | null {
  if (startId === endId) return { nodeIds: [startId], edgeIds: [], distanceMeters: 0 };
  const end = graph.nodes.get(endId);
  if (!end || !graph.nodes.has(startId)) return null;

  const distance = new Map<string, number>([[startId, 0]]);
  const previousNode = new Map<string, string>();
  const previousEdge = new Map<string, string>();
  const open = new MinHeap<string>();
  const settled = new Set<string>();
  open.push(startId, 0, startId);

  while (open.size > 0) {
    const currentId = open.pop()!;
    if (settled.has(currentId)) continue;
    settled.add(currentId);
    if (currentId === endId) break;
    const currentDistance = distance.get(currentId);
    if (currentDistance == null) continue;

    for (const edge of graph.adjacency.get(currentId) ?? []) {
      if (bannedEdgeIds.has(edge.id) || bannedNodeIds.has(edge.to)) continue;
      const candidate = currentDistance + edge.distanceMeters;
      if (candidate >= (distance.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      if (candidate > maxDistanceMeters + 0.001) continue;

      const next = graph.nodes.get(edge.to)!;
      const heuristic = haversineMeters([next.lng, next.lat], [end.lng, end.lat]);
      distance.set(edge.to, candidate);
      previousNode.set(edge.to, currentId);
      previousEdge.set(edge.to, edge.id);
      open.push(edge.to, candidate + heuristic, edge.to);
    }
  }

  const total = distance.get(endId);
  if (total == null) return null;

  const nodeIds = [endId];
  const edgeIds: string[] = [];
  let cursor = endId;
  while (cursor !== startId) {
    const parent = previousNode.get(cursor);
    const edge = previousEdge.get(cursor);
    if (!parent || !edge) return null;
    nodeIds.unshift(parent);
    edgeIds.unshift(edge);
    cursor = parent;
  }

  return { nodeIds, edgeIds, distanceMeters: total };
}

function pathDistance(graph: IndexedGraph, edgeIds: string[]): number {
  return edgeIds.reduce((sum, id) => sum + (graph.edges.get(id)?.distanceMeters ?? 0), 0);
}

/** Generate deterministic loopless alternatives ordered by water distance. */
function yenPaths(
  graph: IndexedGraph,
  startId: string,
  endId: string,
  maxCandidates: number,
  maxDistanceMeters: number,
): GraphPath[] {
  const shortest = aStar(graph, startId, endId);
  if (!shortest) return [];
  const accepted: GraphPath[] = [shortest];
  const candidateByKey = new Map<string, GraphPath>();
  let spurSearches = 0;
  const maxSpurSearches = Math.max(100, maxCandidates * 25);

  for (let k = 1; k < maxCandidates; k++) {
    const previous = accepted[k - 1];
    for (
      let spurIndex = 0;
      spurIndex < previous.nodeIds.length - 1 && spurSearches < maxSpurSearches;
      spurIndex++
    ) {
      const rootNodes = previous.nodeIds.slice(0, spurIndex + 1);
      const rootEdges = previous.edgeIds.slice(0, spurIndex);
      const bannedEdges = new Set<string>();

      for (const route of accepted) {
        const sameRoot = rootNodes.every((nodeId, index) => route.nodeIds[index] === nodeId);
        if (sameRoot && route.edgeIds[spurIndex]) bannedEdges.add(route.edgeIds[spurIndex]);
      }

      const bannedNodes = new Set(rootNodes.slice(0, -1));
      const rootDistance = pathDistance(graph, rootEdges);
      const remainingDistance = maxDistanceMeters - rootDistance;
      if (remainingDistance < 0) continue;
      spurSearches++;
      const spur = aStar(
        graph,
        rootNodes[rootNodes.length - 1],
        endId,
        bannedEdges,
        bannedNodes,
        remainingDistance,
      );
      if (!spur) continue;

      const edgeIds = [...rootEdges, ...spur.edgeIds];
      const distanceMeters = pathDistance(graph, edgeIds);
      if (distanceMeters > maxDistanceMeters + 0.001) continue;
      const nodeIds = [...rootNodes.slice(0, -1), ...spur.nodeIds];
      if (new Set(nodeIds).size !== nodeIds.length) continue;
      const key = edgeIds.join("|");
      if (!candidateByKey.has(key) && !accepted.some((path) => path.edgeIds.join("|") === key)) {
        candidateByKey.set(key, { nodeIds, edgeIds, distanceMeters });
      }
    }

    const next = [...candidateByKey.entries()].sort(
      (a, b) => a[1].distanceMeters - b[1].distanceMeters || a[0].localeCompare(b[0]),
    )[0];
    if (!next) break;
    candidateByKey.delete(next[0]);
    accepted.push(next[1]);
  }

  return accepted;
}

function routeCoherence(graph: IndexedGraph, nodeIds: string[]): number {
  if (nodeIds.length < 3) return 1;
  let penalty = 0;
  let count = 0;

  for (let i = 1; i < nodeIds.length - 1; i++) {
    const a = graph.nodes.get(nodeIds[i - 1]);
    const b = graph.nodes.get(nodeIds[i]);
    const c = graph.nodes.get(nodeIds[i + 1]);
    if (!a || !b || !c) continue;
    const latitudeScale = Math.cos((b.lat * Math.PI) / 180);
    const heading1 = Math.atan2(b.lat - a.lat, (b.lng - a.lng) * latitudeScale);
    const heading2 = Math.atan2(c.lat - b.lat, (c.lng - b.lng) * latitudeScale);
    let change = Math.abs(heading2 - heading1);
    if (change > Math.PI) change = 2 * Math.PI - change;
    penalty += change / Math.PI;
    count++;
  }

  return count === 0 ? 1 : clamp01(1 - penalty / count);
}

function scorePath(
  graph: IndexedGraph,
  path: GraphPath,
  shortestMeters: number,
  maxDetourRatio: number,
): ScoredPath {
  let natural = 0;
  let paddling = 0;
  let quiet = 0;
  let totalWeight = 0;
  let fairwayMeters = 0;

  for (const edgeId of path.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const weight = Math.max(1, edge.distanceMeters);
    natural += clamp01(edge.scenic.natural) * weight;
    paddling += clamp01(edge.scenic.paddling) * weight;
    quiet += clamp01(edge.scenic.quiet) * weight;
    totalWeight += weight;
    if (edge.waterwayType === "fairway") fairwayMeters += weight;
  }

  const divisor = totalWeight || 1;
  const naturalScore = natural / divisor;
  const paddlingScore = paddling / divisor;
  const quietScore = quiet / divisor;
  const coherence = routeCoherence(graph, path.nodeIds);
  const scenicScore = clamp01(
    naturalScore * 0.45 + paddlingScore * 0.25 + quietScore * 0.2 + coherence * 0.1,
  );
  const detourRange = Math.max(0.0001, maxDetourRatio - 1);
  const detourFraction = shortestMeters === 0 ? 0 : path.distanceMeters / shortestMeters - 1;
  const directness = clamp01(1 - detourFraction / detourRange);
  const utility = scenicScore * 0.7 + directness * 0.3;

  const highlights: string[] = [];
  if (naturalScore >= 0.6) highlights.push("Natural shoreline");
  if (paddlingScore >= 0.6) highlights.push("Paddler-friendly waterway");
  if (quietScore >= 0.7) highlights.push("Quieter water corridor");
  if (coherence >= 0.8) highlights.push("Smooth, easy-to-follow course");
  if (highlights.length === 0) highlights.push("Verified all-water course");

  const warnings: string[] = [];
  if (fairwayMeters / divisor >= 0.1) {
    warnings.push(
      "Part of this route follows a mapped navigation fairway; watch for boat traffic.",
    );
  }
  const hazards = [
    ...new Set(path.edgeIds.flatMap((edgeId) => graph.edges.get(edgeId)?.hazards ?? [])),
  ];
  if (hazards.length > 0) {
    warnings.push(`Mapped water hazard${hazards.length === 1 ? "" : "s"}: ${hazards.join(", ")}.`);
  }

  return { ...path, scenicScore, utility, highlights, warnings };
}

function validatePath(graph: IndexedGraph, path: GraphPath): boolean {
  if (path.nodeIds.length !== path.edgeIds.length + 1) return false;
  for (let index = 0; index < path.edgeIds.length; index++) {
    const edge = graph.edges.get(path.edgeIds[index]);
    if (!edge || edge.from !== path.nodeIds[index] || edge.to !== path.nodeIds[index + 1]) {
      return false;
    }
    if (!Number.isFinite(edge.distanceMeters) || edge.distanceMeters <= 0) return false;
    if (edge.provenance === "open_water" && (!edge.waterPolygonId || !edge.validatedWater)) {
      return false;
    }
    if (edge.provenance === "open_water") {
      const polygon = edge.waterPolygonId
        ? graph.waterPolygons.get(edge.waterPolygonId)
        : undefined;
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (
        !polygon ||
        !from ||
        !to ||
        !isSegmentInsideWaterPolygon([from.lng, from.lat], [to.lng, to.lat], polygon)
      ) {
        return false;
      }
    }
    if (
      edge.provenance === "osm_waterway" &&
      (edge.osmWayId == null || !edge.osmNodeIds || edge.osmNodeIds.length !== 2)
    ) {
      return false;
    }
    if (edge.provenance !== "open_water" && edge.provenance !== "osm_waterway") return false;
  }
  return true;
}

function nearbyNodes(
  graph: IndexedGraph,
  waypoint: ScenicRouteWaypoint,
  maxSnapMeters: number,
): Array<{ node: ScenicGraphNode; distanceMeters: number }> {
  const nearby: Array<{ node: ScenicGraphNode; distanceMeters: number }> = [];
  for (const node of graph.nodes.values()) {
    const distanceMeters = haversineMeters([waypoint.lng, waypoint.lat], [node.lng, node.lat]);
    if (distanceMeters > maxSnapMeters) continue;
    nearby.push({ node, distanceMeters });
  }
  return nearby.sort(
    (left, right) =>
      left.distanceMeters - right.distanceMeters || left.node.id.localeCompare(right.node.id),
  );
}

function connectedSnapPair(
  graph: IndexedGraph,
  starts: Array<{ node: ScenicGraphNode; distanceMeters: number }>,
  ends: Array<{ node: ScenicGraphNode; distanceMeters: number }>,
): {
  start: { node: ScenicGraphNode; distanceMeters: number };
  end: { node: ScenicGraphNode; distanceMeters: number };
} | null {
  let best: {
    start: { node: ScenicGraphNode; distanceMeters: number };
    end: { node: ScenicGraphNode; distanceMeters: number };
    snapTotal: number;
  } | null = null;
  for (const start of starts) {
    for (const end of ends) {
      if (start.node.id === end.node.id) continue;
      if (graph.componentByNode.get(start.node.id) !== graph.componentByNode.get(end.node.id)) {
        continue;
      }
      const snapTotal = start.distanceMeters + end.distanceMeters;
      if (
        !best ||
        snapTotal < best.snapTotal ||
        (snapTotal === best.snapTotal &&
          `${start.node.id}|${end.node.id}` < `${best.start.node.id}|${best.end.node.id}`)
      ) {
        best = { start, end, snapTotal };
      }
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function dedupeCoordinates(coordinates: LngLat[]): LngLat[] {
  const result: LngLat[] = [];
  for (const coordinate of coordinates) {
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
      result.push(coordinate);
    }
  }
  return result;
}

function provenanceForPath(
  graph: IndexedGraph,
  path: GraphPath,
): ScenicRouteLeg["waterProvenance"] {
  const values = new Set(path.edgeIds.map((id) => graph.edges.get(id)?.provenance));
  if (values.size > 1) return "mixed";
  return values.has("open_water") ? "open_water" : "osm_centerline";
}

function waterSourcesForPath(graph: IndexedGraph, path: GraphPath): ScenicRouteLeg["waterSources"] {
  const sources = new Map<string, ScenicRouteLeg["waterSources"][number]>();
  for (const edgeId of path.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const key =
      edge.provenance === "osm_waterway" ? `osm/${edge.osmWayId}` : `water/${edge.waterPolygonId}`;
    const existing = sources.get(key);
    if (existing && edge.osmNodeIds) {
      existing.osmNodeIds = [...new Set([...(existing.osmNodeIds ?? []), ...edge.osmNodeIds])];
    } else if (!existing) {
      sources.set(key, {
        provenance: edge.provenance,
        osmWayId: edge.osmWayId,
        osmNodeIds: edge.osmNodeIds,
        relationIds: edge.relationIds,
        waterPolygonId: edge.waterPolygonId,
        waterwayType: edge.waterwayType,
        waterwayName: edge.waterwayName,
      });
    }
  }
  return [...sources.values()];
}

function routeLeg(
  graph: IndexedGraph,
  from: ScenicRouteWaypoint,
  to: ScenicRouteWaypoint,
  legIndex: number,
  options: Required<ScenicRouteOptions>,
): ScenicRouteLeg {
  const starts = nearbyNodes(graph, from, options.maxSnapMeters);
  const ends = nearbyNodes(graph, to, options.maxSnapMeters);
  if (starts.length === 0 || ends.length === 0) {
    const missing = starts.length === 0 ? "start" : "destination";
    throw new ScenicRouteError(
      "WAYPOINT_OFF_NETWORK",
      legIndex,
      `The ${missing} of leg ${legIndex + 1} is not within ${options.maxSnapMeters} m of verified water.`,
      {
        snapDistancesMeters: [starts[0]?.distanceMeters, ends[0]?.distanceMeters].filter(
          (distance): distance is number => distance != null,
        ),
        candidateCount: 0,
        validationResult: "not_run",
      },
    );
  }

  const pair = connectedSnapPair(graph, starts, ends);
  const start = pair?.start ?? starts[0];
  const end = pair?.end ?? ends[0];

  const shortest = aStar(graph, start.node.id, end.node.id);
  if (!shortest) {
    throw new ScenicRouteError(
      "NO_WATER_ROUTE",
      legIndex,
      `No connected all-water route is available for leg ${legIndex + 1}.`,
      {
        snapDistancesMeters: [start.distanceMeters, end.distanceMeters],
        candidateCount: 0,
        validationResult: "not_run",
      },
    );
  }
  if (shortest.edgeIds.length === 0) {
    throw new ScenicRouteError(
      "NO_WATER_ROUTE",
      legIndex,
      `The waypoints for leg ${legIndex + 1} snap to the same water location. Choose distinct launch points.`,
      {
        snapDistancesMeters: [start.distanceMeters, end.distanceMeters],
        candidateCount: 0,
        validationResult: "not_run",
      },
    );
  }

  const candidates = yenPaths(
    graph,
    start.node.id,
    end.node.id,
    options.maxCandidates,
    shortest.distanceMeters * options.maxDetourRatio,
  );
  const selected = candidates
    .map((candidate) =>
      scorePath(graph, candidate, shortest.distanceMeters, options.maxDetourRatio),
    )
    .sort(
      (a, b) =>
        b.utility - a.utility ||
        a.distanceMeters - b.distanceMeters ||
        a.edgeIds.join("|").localeCompare(b.edgeIds.join("|")),
    )[0];

  if (!selected || !validatePath(graph, selected)) {
    throw new ScenicRouteError(
      "ROUTE_VALIDATION_FAILED",
      legIndex,
      `The generated route for leg ${legIndex + 1} could not be verified as water-only.`,
      {
        snapDistancesMeters: [start.distanceMeters, end.distanceMeters],
        candidateCount: candidates.length,
        validationResult: "failed",
      },
    );
  }

  const coordinates = selected.nodeIds.map((id) => {
    const node = graph.nodes.get(id)!;
    return [node.lng, node.lat] as LngLat;
  });
  const accessConnectors: LngLat[][] = [];
  if (start.distanceMeters > 1) {
    accessConnectors.push([
      [from.lng, from.lat],
      [start.node.lng, start.node.lat],
    ]);
  }
  if (end.distanceMeters > 1) {
    accessConnectors.push([
      [end.node.lng, end.node.lat],
      [to.lng, to.lat],
    ]);
  }

  return {
    fromIndex: legIndex,
    toIndex: legIndex + 1,
    coordinates,
    distanceMeters: selected.distanceMeters,
    scenicScore: selected.scenicScore,
    snapDistancesMeters: [start.distanceMeters, end.distanceMeters],
    accessConnectors,
    waterProvenance: provenanceForPath(graph, selected),
    waterSources: waterSourcesForPath(graph, selected),
    scenicHighlights: selected.highlights,
    warnings: selected.warnings,
    candidateCount: candidates.length,
  };
}

export function routeScenicWaterGraph(
  graph: ScenicGraph,
  waypoints: ScenicRouteWaypoint[],
  requestedOptions: ScenicRouteOptions = {},
): ScenicRouteResult {
  if (waypoints.length < 2) {
    throw new ScenicRouteError("NO_WATER_ROUTE", 0, "At least two waypoints are required.");
  }

  const options: Required<ScenicRouteOptions> = {
    maxSnapMeters: Math.max(1, requestedOptions.maxSnapMeters ?? DEFAULT_MAX_SNAP_METERS),
    maxDetourRatio: Math.max(
      1,
      Math.min(
        DEFAULT_MAX_DETOUR_RATIO,
        requestedOptions.maxDetourRatio ?? DEFAULT_MAX_DETOUR_RATIO,
      ),
    ),
    maxCandidates: Math.max(
      1,
      Math.min(DEFAULT_MAX_CANDIDATES, requestedOptions.maxCandidates ?? DEFAULT_MAX_CANDIDATES),
    ),
  };
  const indexed = indexGraph(graph);
  const legs: ScenicRouteLeg[] = [];

  for (let index = 0; index < waypoints.length - 1; index++) {
    legs.push(routeLeg(indexed, waypoints[index], waypoints[index + 1], index, options));
  }

  const distanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0);
  const scenicScore =
    distanceMeters === 0
      ? 0
      : legs.reduce((sum, leg) => sum + leg.scenicScore * leg.distanceMeters, 0) / distanceMeters;

  return {
    dataVersion: graph.dataVersion,
    profile: "scenic_water",
    coordinates: dedupeCoordinates(legs.flatMap((leg) => leg.coordinates)),
    distanceMeters,
    scenicScore,
    scenicHighlights: [...new Set(legs.flatMap((leg) => leg.scenicHighlights))],
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    legs,
  };
}

export function mergeGraphShards(shards: ScenicGraph[]): ScenicGraph {
  if (shards.length === 0) {
    return { dataVersion: "unknown", nodes: [], edges: [], waterPolygons: [], constraints: [] };
  }
  const version = shards[0].dataVersion;
  if (shards.some((shard) => shard.dataVersion !== version)) {
    throw new Error("Routing graph shards use different data versions.");
  }
  const nodes = new Map<string, ScenicGraphNode>();
  const edges = new Map<string, ScenicGraphEdge>();
  const waterPolygons = new Map<string, ScenicWaterPolygon>();
  const constraints = new Map<string, ScenicGraphConstraint>();
  for (const shard of shards) {
    for (const node of shard.nodes) nodes.set(node.id, node);
    for (const edge of shard.edges) edges.set(edge.id, edge);
    for (const polygon of shard.waterPolygons ?? []) waterPolygons.set(polygon.id, polygon);
    for (const constraint of shard.constraints ?? []) constraints.set(constraint.id, constraint);
  }
  return {
    dataVersion: version,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    waterPolygons: [...waterPolygons.values()],
    constraints: [...constraints.values()],
  };
}
