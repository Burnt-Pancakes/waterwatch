import { useEffect, useRef, useState } from "react";
import type { TripPlannerSite, TripWaypoint } from "@/lib/tripPlanner";
import { DC_CENTER, PLAN_MAP_LIGHT_STYLE } from "./planMapStyles";
import {
  accessConnectorsGeoJson,
  routeGeoJson,
  type PlannerGeoJsonData,
} from "./tripPlannerMapGeoJson";

type MapInstance = {
  remove: () => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: { padding?: number; animate?: boolean },
  ) => void;
  on: (
    event: string,
    layerIdOrHandler: string | (() => void),
    listener?: (e: MapClickEvent) => void,
  ) => void;
  off: (event: string, layerId: string, listener: (e: MapClickEvent) => void) => void;
  getSource: (id: string) => { setData: (data: PlannerGeoJsonData) => void } | undefined;
  addSource: (id: string, source: object) => void;
  addLayer: (layer: object) => void;
  getLayer: (id: string) => unknown;
  loaded?: () => boolean;
};

type MapClickEvent = {
  features?: Array<{ properties?: { id?: string } }>;
};

type MapLibreClient = {
  Map: new (options: {
    container: HTMLElement;
    style: object;
    center: [number, number];
    zoom: number;
    attributionControl: boolean;
    interactive: boolean;
  }) => MapInstance;
};

interface TripPlannerMapProps {
  sites: TripPlannerSite[];
  waypoints: TripWaypoint[];
  /** Verified paddling geometry. No line is drawn when routing is unavailable. */
  routeCoordinates?: [number, number][];
  /** Short site-to-water approaches, kept distinct from paddling distance. */
  accessConnectors?: [number, number][][];
  onSiteSelect?: (site: TripPlannerSite) => void;
  interactive?: boolean;
  className?: string;
  fitToRoute?: boolean;
}

function sitesToGeoJson(sites: TripPlannerSite[]): PlannerGeoJsonData {
  return {
    type: "FeatureCollection",
    features: sites.map((s) => ({
      type: "Feature",
      properties: { id: s.id },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
}

function waypointsToPins(waypoints: TripWaypoint[]): PlannerGeoJsonData {
  return {
    type: "FeatureCollection",
    features: waypoints.map((w, i) => ({
      type: "Feature",
      properties: { label: String(i + 1) },
      geometry: { type: "Point", coordinates: [w.lng, w.lat] },
    })),
  };
}

export function TripPlannerMap({
  sites,
  waypoints,
  routeCoordinates,
  accessConnectors,
  onSiteSelect,
  interactive = true,
  className = "h-[50vh] w-full",
  fitToRoute = false,
}: TripPlannerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const sitesById = useRef(new Map<string, TripPlannerSite>());
  const clickHandlerRef = useRef<((e: MapClickEvent) => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sitesById.current = new Map(sites.map((s) => [s.id, s]));
  }, [sites]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    void (async () => {
      const [{ default: maplibregl }] = await Promise.all([
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);

      if (cancelled || !containerRef.current) return;

      const client = maplibregl as unknown as MapLibreClient;
      const map = new client.Map({
        container: containerRef.current,
        style: PLAN_MAP_LIGHT_STYLE,
        center: DC_CENTER,
        zoom: 11,
        attributionControl: false,
        interactive,
      });

      mapRef.current = map;

      const setupLayers = () => {
        if (!map.getSource("planner-sites")) {
          map.addSource("planner-sites", {
            type: "geojson",
            data: sitesToGeoJson(sites),
          });
          map.addLayer({
            id: "planner-sites-dots",
            type: "circle",
            source: "planner-sites",
            paint: {
              "circle-color": "#0d9488",
              "circle-radius": 5,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
            },
          });
        }

        if (!map.getSource("planner-route")) {
          map.addSource("planner-route", {
            type: "geojson",
            data: routeGeoJson(routeCoordinates),
          });
          map.addLayer({
            id: "planner-route-line",
            type: "line",
            source: "planner-route",
            paint: {
              "line-color": "#0f6b8a",
              "line-width": 4,
              "line-opacity": 0.9,
            },
          });
        }

        if (!map.getSource("planner-access-connectors")) {
          map.addSource("planner-access-connectors", {
            type: "geojson",
            data: accessConnectorsGeoJson(accessConnectors),
          });
          map.addLayer({
            id: "planner-access-connectors-line",
            type: "line",
            source: "planner-access-connectors",
            paint: {
              "line-color": "#64748b",
              "line-width": 2,
              "line-dasharray": [1.5, 1.5],
            },
          });
        }

        if (!map.getSource("planner-pins")) {
          map.addSource("planner-pins", {
            type: "geojson",
            data: waypointsToPins(waypoints),
          });
          map.addLayer({
            id: "planner-pins-layer",
            type: "circle",
            source: "planner-pins",
            paint: {
              "circle-color": "#1A3A5C",
              "circle-radius": 14,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          });
        }

        setReady(true);
      };

      map.on("load", setupLayers);
      if (map.loaded?.()) setupLayers();
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource("planner-sites")?.setData(sitesToGeoJson(sites));
    map.getSource("planner-route")?.setData(routeGeoJson(routeCoordinates));
    map.getSource("planner-access-connectors")?.setData(accessConnectorsGeoJson(accessConnectors));
    map.getSource("planner-pins")?.setData(waypointsToPins(waypoints));

    if (fitToRoute && waypoints.length >= 2) {
      const lineCoords =
        routeCoordinates && routeCoordinates.length >= 2
          ? routeCoordinates
          : waypoints.map((w) => [w.lng, w.lat] as [number, number]);
      const lngs = lineCoords.map((c) => c[0]);
      const lats = lineCoords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, animate: false },
      );
    }
  }, [sites, waypoints, routeCoordinates, accessConnectors, ready, fitToRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !onSiteSelect) return;

    const handler = (e: MapClickEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (!id) return;
      const site = sitesById.current.get(id);
      if (site) onSiteSelect(site);
    };

    if (clickHandlerRef.current) {
      map.off("click", "planner-sites-dots", clickHandlerRef.current);
    }
    clickHandlerRef.current = handler;
    map.on("click", "planner-sites-dots", handler);

    return () => {
      if (clickHandlerRef.current) {
        map.off("click", "planner-sites-dots", clickHandlerRef.current);
      }
    };
  }, [onSiteSelect, ready, sites]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="trip-planner-map"
      data-waypoint-count={waypoints.length}
      data-route-point-count={routeCoordinates?.length ?? 0}
    />
  );
}
