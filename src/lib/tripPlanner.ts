import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type LngLat = [number, number];

export interface WaterRouteSegment {
  coordinates: LngLat[];
  distanceNm: number;
  /** V2-produced route segments are always verified water geometry. */
  viaWater: boolean;
}

export type WaterRouteFailureCode =
  | "WAYPOINT_OFF_NETWORK"
  | "NO_WATER_ROUTE"
  | "ROUTE_VALIDATION_FAILED"
  | "ROUTING_DATA_UNAVAILABLE";

export interface ScenicWaterRouteLeg {
  fromIndex: number;
  toIndex: number;
  coordinates: LngLat[];
  distanceMeters: number;
  scenicScore: number;
  snapDistancesMeters: [number, number];
  accessConnectors: LngLat[][];
  waterProvenance: "osm_centerline" | "open_water" | "mixed";
  waterSources?: Array<{
    provenance: "osm_waterway" | "open_water";
    osmWayId?: number;
    osmNodeIds?: number[];
    relationIds?: number[];
    waterPolygonId?: string;
    waterwayType?: string;
    waterwayName?: string;
  }>;
  scenicHighlights: string[];
  warnings: string[];
}

export interface ScenicWaterRoute {
  dataVersion: string;
  profile: "scenic_water";
  coordinates: LngLat[];
  distanceMeters: number;
  scenicScore: number;
  scenicHighlights: string[];
  warnings: string[];
  legs: ScenicWaterRouteLeg[];
  attribution?: string;
  requestId?: string;
}

export class WaterRouteRequestError extends Error {
  constructor(
    public readonly code: WaterRouteFailureCode,
    public readonly legIndex: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WaterRouteRequestError";
  }
}

// The calculate_trip_waypoints/find_best_departure RPCs are not yet in generated types.ts.
// Cast to the base SupabaseClient to bypass those strict RPC overloads, per CLAUDE.md.
const db = supabase as unknown as SupabaseClient;

export type TripType = "out_and_back" | "tidal_assist" | "tidal_transit";
export type TideDirection = "Flooding" | "Ebbing";
export type WindowQuality = "good" | "fair" | "poor";
export type PlannerStep = "route" | "windows" | "timeline";
export type TimelineMilestoneKind = "launch" | "arrive" | "wait" | "return_launch" | "home";

export const DEFAULT_NOAA_STATION = "NOAA-8594900";
export const PADDLING_SPEED_OPTIONS = [2, 2.5, 3, 3.5, 4] as const;

export interface TripPlannerSite {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  site_type: string;
  is_tidal: boolean;
  tidal_gauge_station_id: string | null;
}

export interface LegStats {
  oneWayDistanceNm: number;
  oneWayMinutes: number;
  roundTripDistanceNm: number;
  roundTripMinutes: number;
}

export interface WindowQualityPresentation {
  quality: WindowQuality;
  label: string;
  shortLabel: string;
  borderClass: string;
  badgeClass: string;
  bannerClass: string;
  bannerText: string;
}

export interface TimelineMilestone {
  kind: TimelineMilestoneKind;
  label: string;
  time: string;
  siteName: string;
  tideDirection?: TideDirection | null;
  tideHeightFt?: number | null;
  minutesToSlack?: number | null;
  segmentDistanceNm?: number;
  segmentMinutes?: number;
  tideAssistNote?: string;
}

export interface ShareTripParams {
  origin?: string;
  dest?: string;
  depart?: string;
  type?: TripType;
}

export interface TripWaypoint {
  order_index: number;
  name: string;
  lat: number;
  lng: number;
  noaa_station_id?: string;
  site_id?: string;
  estimated_arrival_at?: string;
  distance_from_prev_nm?: number;
  travel_time_minutes?: number;
  tide_height_ft?: number;
  tide_direction?: TideDirection;
  minutes_to_slack?: number;
}

export interface TripPlan {
  id?: string;
  name: string;
  trip_type: TripType;
  departure_time?: string;
  paddling_speed_knots: number;
  waypoints: TripWaypoint[];
  notes?: string;
}

export interface DepartureWindow {
  departure_time: string;
  departure_tide_state: string;
  departure_direction: string;
  arrival_time: string;
  arrival_tide_state: string;
  arrival_direction: string;
  return_departure_time: string;
  return_tide_state: string;
  return_direction: string;
  estimated_home_time: string;
  window_quality: WindowQuality;
  recommendation: string;
}

type TripWaypointRow = {
  order_index: number;
  custom_name: string | null;
  lat: number;
  lng: number;
  site_id: string | null;
  noaa_station_id: string | null;
  estimated_arrival_at: string | null;
  distance_from_prev_nm: number | null;
  travel_time_minutes: number | null;
  tide_height_ft: number | null;
  tide_direction: string | null;
  minutes_to_slack: number | null;
};

const WINDOW_QUALITY_ORDER: Record<WindowQuality, number> = {
  good: 0,
  fair: 1,
  poor: 2,
};

export const WINDOW_QUALITY_PRESENTATION: Record<WindowQuality, WindowQualityPresentation> = {
  good: {
    quality: "good",
    label: "GOOD WINDOW",
    shortLabel: "Good window",
    borderClass: "border-l-4 border-l-emerald-500",
    badgeClass: "text-emerald-700 dark:text-emerald-300",
    bannerClass:
      "bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100",
    bannerText: "Good conditions — tidal assist both ways",
  },
  fair: {
    quality: "fair",
    label: "FAIR WINDOW",
    shortLabel: "Fair window",
    borderClass: "border-l-4 border-l-amber-500",
    badgeClass: "text-amber-700 dark:text-amber-300",
    bannerClass:
      "bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950 dark:text-amber-100",
    bannerText: "Fair conditions — some current expected",
  },
  poor: {
    quality: "poor",
    label: "CHALLENGING",
    shortLabel: "Challenging",
    borderClass: "border-l-4 border-l-gray-400",
    badgeClass: "text-gray-700 dark:text-gray-300",
    bannerClass: "bg-red-50 text-red-900 border border-red-200 dark:bg-red-950 dark:text-red-100",
    bannerText: "Challenging — paddling against current",
  },
};

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  out_and_back: "Out and back",
  tidal_assist: "Tidal assist",
  tidal_transit: "One way",
};

function mapWaypointRow(row: TripWaypointRow): TripWaypoint {
  return {
    order_index: row.order_index,
    name: row.custom_name ?? "Waypoint",
    lat: Number(row.lat),
    lng: Number(row.lng),
    site_id: row.site_id ?? undefined,
    noaa_station_id: row.noaa_station_id ?? undefined,
    estimated_arrival_at: row.estimated_arrival_at ?? undefined,
    distance_from_prev_nm: row.distance_from_prev_nm ?? undefined,
    travel_time_minutes: row.travel_time_minutes ?? undefined,
    tide_height_ft: row.tide_height_ft ?? undefined,
    tide_direction: (row.tide_direction as TideDirection | null) ?? undefined,
    minutes_to_slack: row.minutes_to_slack ?? undefined,
  };
}

function parseComputedWaypoints(data: Json): TripWaypoint[] {
  if (!Array.isArray(data)) return [];
  return data.map((row, index) => {
    const wp = row as Record<string, Json>;
    return {
      order_index: Number(wp.order_index ?? index),
      name: String(wp.name ?? "Waypoint"),
      lat: Number(wp.lat),
      lng: Number(wp.lng),
      noaa_station_id: wp.noaa_station_id != null ? String(wp.noaa_station_id) : undefined,
      estimated_arrival_at:
        wp.estimated_arrival_at != null ? String(wp.estimated_arrival_at) : undefined,
      distance_from_prev_nm:
        wp.distance_from_prev_nm != null ? Number(wp.distance_from_prev_nm) : undefined,
      travel_time_minutes:
        wp.travel_time_minutes != null ? Number(wp.travel_time_minutes) : undefined,
      tide_height_ft: wp.tide_height_ft != null ? Number(wp.tide_height_ft) : undefined,
      tide_direction:
        wp.tide_direction != null ? (String(wp.tide_direction) as TideDirection) : undefined,
      minutes_to_slack: wp.minutes_to_slack != null ? Number(wp.minutes_to_slack) : undefined,
    };
  });
}

/**
 * Calculate tide state and travel time for each waypoint
 * given a departure time and paddling speed.
 */
export async function calculateWaypoints(
  waypoints: TripWaypoint[],
  departureTime: Date,
  speedKnots: number = 3.0,
): Promise<TripWaypoint[]> {
  const { data, error } = await db.rpc("calculate_trip_waypoints", {
    p_waypoints: waypoints as unknown as Json,
    p_departure_time: departureTime.toISOString(),
    p_speed_knots: speedKnots,
  });
  if (error) throw error;
  return parseComputedWaypoints(data as Json);
}

/**
 * Find candidate departure windows for a tidal-assist trip.
 * Returns up to 48 windows (every 30 min over 24h), sorted by quality.
 */
export async function findBestDeparture(
  originStationId: string,
  destStationId: string,
  date: Date,
  travelMinutes: number,
  speedKnots: number = 3.0,
): Promise<DepartureWindow[]> {
  const { data, error } = await db.rpc("find_best_departure", {
    p_origin_station: originStationId,
    p_dest_station: destStationId,
    p_date: date.toISOString().split("T")[0],
    p_travel_minutes: travelMinutes,
    p_paddling_speed_kts: speedKnots,
  });
  if (error) throw error;

  return ((data as unknown as DepartureWindow[]) ?? []).sort(
    (a, b) => WINDOW_QUALITY_ORDER[a.window_quality] - WINDOW_QUALITY_ORDER[b.window_quality],
  );
}

/** Save a trip plan and its waypoints for the authenticated user. */
export async function saveTrip(plan: TripPlan): Promise<string> {
  const { data: trip, error: tripError } = await db
    .from("trips")
    .insert({
      name: plan.name,
      trip_type: plan.trip_type,
      departure_time: plan.departure_time ?? null,
      paddling_speed_knots: plan.paddling_speed_knots,
      notes: plan.notes ?? null,
    })
    .select("id")
    .single();

  if (tripError) throw tripError;

  const waypoints = plan.waypoints.map((w) => ({
    trip_id: trip.id,
    order_index: w.order_index,
    waypoint_type: w.site_id ? "site" : "custom",
    site_id: w.site_id ?? null,
    custom_name: w.name,
    lat: w.lat,
    lng: w.lng,
    noaa_station_id: w.noaa_station_id ?? null,
    estimated_arrival_at: w.estimated_arrival_at ?? null,
    tide_height_ft: w.tide_height_ft ?? null,
    tide_direction: w.tide_direction ?? null,
    minutes_to_slack: w.minutes_to_slack ?? null,
    distance_from_prev_nm: w.distance_from_prev_nm ?? null,
    travel_time_minutes: w.travel_time_minutes ?? null,
  }));

  const { error: wpError } = await db.from("trip_waypoints").insert(waypoints);
  if (wpError) throw wpError;

  return trip.id;
}

/** Load all trips for the current user. */
export async function loadMyTrips(): Promise<TripPlan[]> {
  const { data, error } = await db
    .from("trips")
    .select("*, trip_waypoints (*)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  type TripRow = {
    id: string;
    name: string;
    trip_type: string;
    departure_time: string | null;
    paddling_speed_knots: number | null;
    notes: string | null;
    trip_waypoints: TripWaypointRow[] | null;
  };
  return ((data as unknown as TripRow[]) ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    trip_type: t.trip_type as TripType,
    departure_time: t.departure_time ?? undefined,
    paddling_speed_knots: Number(t.paddling_speed_knots ?? 3),
    notes: t.notes ?? undefined,
    waypoints: ((t.trip_waypoints ?? []) as TripWaypointRow[])
      .sort((a, b) => a.order_index - b.order_index)
      .map(mapWaypointRow),
  }));
}

/** Delete a trip and its waypoints (cascade). */
export async function deleteTrip(tripId: string): Promise<void> {
  const { error } = await db.from("trips").delete().eq("id", tripId);
  if (error) throw error;
}

/** Load active sites for the trip planner map and search. */
export async function loadTripPlannerSites(): Promise<TripPlannerSite[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, slug, lat, lng, site_type, is_tidal, tidal_gauge_station_id")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    lat: Number(row.lat),
    lng: Number(row.lng),
    site_type: row.site_type,
    is_tidal: Boolean(row.is_tidal),
    tidal_gauge_station_id: row.tidal_gauge_station_id,
  }));
}

/** Filter loaded sites by name (client-side, case-insensitive). */
export function filterTripPlannerSites(
  sites: TripPlannerSite[],
  query: string,
  options?: { tidalOnly?: boolean; limit?: number },
): TripPlannerSite[] {
  const q = query.trim().toLowerCase();
  let results = sites;
  if (options?.tidalOnly) {
    results = results.filter((s) => s.is_tidal);
  }
  if (q) {
    results = results.filter((s) => s.name.toLowerCase().includes(q));
  }
  const limit = options?.limit ?? 10;
  return results.slice(0, limit);
}

export function siteToWaypoint(site: TripPlannerSite, orderIndex: number): TripWaypoint {
  return {
    order_index: orderIndex,
    name: site.name,
    lat: site.lat,
    lng: site.lng,
    site_id: site.id,
    noaa_station_id: resolveTideStation(site),
  };
}

export function resolveTideStation(
  site: Pick<TripPlannerSite, "is_tidal" | "tidal_gauge_station_id">,
): string | undefined {
  if (site.tidal_gauge_station_id) return site.tidal_gauge_station_id;
  if (site.is_tidal) return DEFAULT_NOAA_STATION;
  return undefined;
}

export function hasTidalDataForRoute(waypoints: TripWaypoint[]): boolean {
  if (waypoints.length < 2) return false;
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  return Boolean(first.noaa_station_id && last.noaa_station_id);
}

export function computeLegStats(
  waypoints: TripWaypoint[],
  speedKnots: number,
  tripType: TripType,
  segments?: WaterRouteSegment[],
): LegStats {
  let oneWayDistanceNm = 0;
  let oneWayMinutes = 0;
  const useSegments = segments && segments.length === waypoints.length - 1;

  if (useSegments) {
    for (const seg of segments) {
      oneWayDistanceNm += seg.distanceNm;
      oneWayMinutes += (seg.distanceNm / speedKnots) * 60;
    }
  } else {
    for (let i = 1; i < waypoints.length; i++) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const legNm = haversineNM(prev.lat, prev.lng, curr.lat, curr.lng);
      oneWayDistanceNm += legNm;
      oneWayMinutes += (legNm / speedKnots) * 60;
    }
  }

  const isRoundTrip = tripType === "out_and_back" || tripType === "tidal_assist";
  return {
    oneWayDistanceNm,
    oneWayMinutes,
    roundTripDistanceNm: isRoundTrip ? oneWayDistanceNm * 2 : oneWayDistanceNm,
    roundTripMinutes: isRoundTrip ? oneWayMinutes * 2 : oneWayMinutes,
  };
}

export function estimateOneWayTravelMinutes(
  waypoints: TripWaypoint[],
  speedKnots: number,
  segments?: WaterRouteSegment[],
): number {
  return Math.round(
    computeLegStats(waypoints, speedKnots, "tidal_transit", segments).oneWayMinutes,
  );
}

/**
 * Get a verified, scenic water route from the versioned same-origin route API.
 * Failures are surfaced to the caller; this function never substitutes a direct line.
 */
export async function getWaterwayRoute(
  waypoints: TripWaypoint[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ScenicWaterRoute | null> {
  if (waypoints.length < 2) return null;

  try {
    const response = await (options.fetchImpl ?? fetch)("/api/route-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        waypoints: waypoints.map((waypoint) => ({
          lng: waypoint.lng,
          lat: waypoint.lat,
          siteId: waypoint.site_id,
          name: waypoint.name,
        })),
        profile: "scenic_water",
        maxDetourRatio: 1.35,
      }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const failure = (payload as { error?: Record<string, unknown> } | null)?.error;
      throw new WaterRouteRequestError(
        (typeof failure?.code === "string"
          ? failure.code
          : "ROUTING_DATA_UNAVAILABLE") as WaterRouteFailureCode,
        typeof failure?.legIndex === "number" ? failure.legIndex : null,
        typeof failure?.message === "string"
          ? failure.message
          : "Verified water routing is temporarily unavailable.",
      );
    }

    const result = payload as ScenicWaterRoute | null;
    if (
      !result ||
      result.profile !== "scenic_water" ||
      !Array.isArray(result.coordinates) ||
      result.coordinates.length < 2 ||
      !Number.isFinite(result.distanceMeters) ||
      result.distanceMeters <= 0 ||
      !Array.isArray(result.legs) ||
      result.legs.length !== waypoints.length - 1 ||
      result.legs.some(
        (leg) =>
          !Array.isArray(leg.coordinates) ||
          leg.coordinates.length < 2 ||
          !Number.isFinite(leg.distanceMeters) ||
          leg.distanceMeters <= 0,
      )
    ) {
      throw new WaterRouteRequestError(
        "ROUTE_VALIDATION_FAILED",
        null,
        "The water-routing service returned an invalid route.",
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WaterRouteRequestError) throw err;
    throw new WaterRouteRequestError(
      "ROUTING_DATA_UNAVAILABLE",
      null,
      "Verified water routing is temporarily unavailable.",
    );
  }
}

export function routeResultToSegments(route: ScenicWaterRoute | null): WaterRouteSegment[] {
  if (!route) return [];
  return route.legs.map((leg) => ({
    coordinates: leg.coordinates,
    distanceNm: leg.distanceMeters / 1852,
    viaWater: true,
  }));
}

export function applyRouteDistances(
  waypoints: TripWaypoint[],
  segments: WaterRouteSegment[],
): TripWaypoint[] {
  if (segments.length !== waypoints.length - 1) return waypoints;
  return waypoints.map((waypoint, index) => ({
    ...waypoint,
    distance_from_prev_nm: index === 0 ? 0 : segments[index - 1].distanceNm,
  }));
}

export function pickDisplayWindows(windows: DepartureWindow[]): DepartureWindow[] {
  const buckets: Record<WindowQuality, DepartureWindow[]> = { good: [], fair: [], poor: [] };
  for (const w of windows) {
    buckets[w.window_quality].push(w);
  }
  return [...buckets.good.slice(0, 2), ...buckets.fair.slice(0, 2), ...buckets.poor.slice(0, 2)];
}

export function getWindowQualityPresentation(quality: WindowQuality): WindowQualityPresentation {
  return WINDOW_QUALITY_PRESENTATION[quality];
}

export function formatPlannerTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatPlannerDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function buildShareUrl(
  baseUrl: string,
  params: ShareTripParams & { origin: string; dest: string },
): string {
  const url = new URL("/plan", baseUrl);
  url.searchParams.set("origin", params.origin);
  url.searchParams.set("dest", params.dest);
  if (params.depart) url.searchParams.set("depart", params.depart);
  if (params.type) url.searchParams.set("type", params.type);
  return url.toString();
}

export function parseShareParams(search: string): ShareTripParams {
  const sp = new URLSearchParams(search);
  const type = sp.get("type");
  const validType =
    type === "out_and_back" || type === "tidal_assist" || type === "tidal_transit"
      ? type
      : undefined;
  return {
    origin: sp.get("origin") ?? undefined,
    dest: sp.get("dest") ?? undefined,
    depart: sp.get("depart") ?? undefined,
    type: validType,
  };
}

export function buildTimelineMilestones(
  waypoints: TripWaypoint[],
  window: DepartureWindow | null,
  tripType: TripType,
): TimelineMilestone[] {
  if (!window || waypoints.length < 2) return [];

  const launch = waypoints[0];
  const dest = waypoints[waypoints.length - 1];
  const segmentNm = waypoints.slice(1).reduce((total, waypoint, index) => {
    if (waypoint.distance_from_prev_nm != null) return total + waypoint.distance_from_prev_nm;
    const previous = waypoints[index];
    return total + haversineNM(previous.lat, previous.lng, waypoint.lat, waypoint.lng);
  }, 0);
  const computedMinutes = waypoints
    .slice(1)
    .map((waypoint) => waypoint.travel_time_minutes)
    .filter((minutes): minutes is number => minutes != null);
  const segmentMin =
    computedMinutes.length === waypoints.length - 1
      ? computedMinutes.reduce((total, minutes) => total + minutes, 0)
      : Math.round((segmentNm / 3) * 60);

  const milestones: TimelineMilestone[] = [
    {
      kind: "launch",
      label: "LAUNCH",
      time: window.departure_time,
      siteName: launch.name,
      tideDirection: parseTideDirection(window.departure_direction),
      segmentDistanceNm: segmentNm,
      segmentMinutes: segmentMin,
    },
    {
      kind: "arrive",
      label: "ARRIVE",
      time: window.arrival_time,
      siteName: dest.name,
      tideDirection: parseTideDirection(window.arrival_direction),
    },
  ];

  if (tripType === "tidal_transit") {
    return milestones;
  }

  if (tripType === "tidal_assist") {
    milestones.push({
      kind: "wait",
      label: "WAIT FOR TURN",
      time: window.return_departure_time,
      siteName: dest.name,
      tideDirection: parseTideDirection(window.return_direction),
    });
  }

  milestones.push(
    {
      kind: "return_launch",
      label: "RETURN LAUNCH",
      time: window.return_departure_time,
      siteName: dest.name,
      tideDirection: parseTideDirection(window.return_direction),
      tideAssistNote: window.return_direction === "Ebbing" ? "Tide pushing you home" : undefined,
      segmentDistanceNm: segmentNm,
      segmentMinutes: segmentMin,
    },
    {
      kind: "home",
      label: "HOME",
      time: window.estimated_home_time,
      siteName: launch.name,
      tideDirection: parseTideDirection(window.return_direction),
    },
  );

  return milestones;
}

function parseTideDirection(value: string | undefined): TideDirection | null {
  if (value === "Flooding" || value === "Ebbing") return value;
  return null;
}

export function buildSimpleMilestones(waypoints: TripWaypoint[]): TimelineMilestone[] {
  if (!waypoints.length) return [];
  return waypoints.map((wp, index) => ({
    kind: index === 0 ? "launch" : index === waypoints.length - 1 ? "arrive" : "arrive",
    label: index === 0 ? "LAUNCH" : "ARRIVE",
    time: wp.estimated_arrival_at ?? new Date().toISOString(),
    siteName: wp.name,
    tideDirection: wp.tide_direction ?? null,
    tideHeightFt: wp.tide_height_ft ?? null,
    minutesToSlack: wp.minutes_to_slack ?? null,
    segmentDistanceNm: wp.distance_from_prev_nm,
    segmentMinutes: wp.travel_time_minutes,
  }));
}

/** Haversine distance in nautical miles. */
export function haversineNM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Format nautical miles for display. */
export function formatDistance(nm: number): string {
  if (nm < 0.1) {
    return `${Math.round(nm * 6076)} ft`;
  }
  return `${nm.toFixed(1)} nm`;
}

/** Format travel time for display. */
export function formatTravelTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
