// Map tile fix synced from GitHub
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import Supercluster from "supercluster";
import { Crosshair, Grid3X3, MapPin, Minus, Plus, Undo } from "@/components/icons";
import { useServerFn } from "@tanstack/react-start";
import { SiteMarker } from "./SiteMarker";
import { SiteBottomSheet } from "./SiteBottomSheet";
import { MapStyleSwitcher, type MapStyleMode, MAP_STYLE_STORAGE_KEY } from "./MapStyleSwitcher";
import { filterSitesByType, FILTER_OPTIONS, type SiteTypeFilter } from "./filterSites";
import { SITE_TYPE_ICONS, type SiteType } from "./siteMarkerConstants";
import { MapTopControls } from "./MapTopControls";
import type { SiteFeature, SitesFeatureCollection } from "./types";
import { cn } from "@/lib/utils";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { CreateSiteSheet } from "./CreateSiteSheet";
import { MySpotsList } from "./MySpotsList";
import { listUserSites, type PersonalSite } from "@/lib/userSites.functions";
import { SeaNettleMarker, SeaNettleToggle, useSeaNettleData, TOAST as NETTLE_TOAST } from "@/modules/seaNettles";

// CartoCDN Voyager tiles — requires a public Carto API key appended to tile URLs.
// Light: voyager, Dark: dark_all
// Fallback from OpenFreeMap which had null coordinate bugs.
// Alternative: https://tiles.openfreemap.org/styles/liberty
const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/">CARTO</a>';

function makeCartoStyle(variant: "voyager" | "dark_all") {
  const key = import.meta.env.VITE_CARTO_API_KEY;
  const suffix = key ? `?key=${key}` : "";
  return {
    version: 8 as const,
    sources: {
      carto: {
        type: "raster" as const,
        tiles: [`https://basemaps.cartocdn.com/rastertiles/${variant}/{z}/{x}/{y}@2x.png${suffix}`],
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "carto-tiles",
        type: "raster" as const,
        source: "carto",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}

const CARTO_LIGHT_STYLE = makeCartoStyle("voyager");
const CARTO_DARK_STYLE = makeCartoStyle("dark_all");

/**
 * ESRI World Imagery satellite basemap style (raster tiles, no API key).
 * Attribution required by Esri Terms of Use.
 */
const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    esri: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    },
  },
  layers: [
    {
      id: "esri-satellite",
      type: "raster" as const,
      source: "esri",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

const DC_CENTER: [number, number] = [-77.0369, 38.9072];

type MapBounds = {
  getWest: () => number;
  getSouth: () => number;
  getEast: () => number;
  getNorth: () => number;
};

type MapInstance = {
  remove: () => void;
  setStyle: (style: string | object) => void;
  getBounds: () => MapBounds;
  getZoom: () => number;
  getCenter: () => { lng: number; lat: number };
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (options: {
    center: [number, number];
    zoom: number;
    duration?: number;
    offset?: [number, number];
  }) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type MarkerInstance = {
  setLngLat: (lngLat: [number, number]) => MarkerInstance;
  addTo: (map: MapInstance) => MarkerInstance;
  remove: () => void;
};

type MapLibreClient = {
  Map: new (options: {
    container: HTMLElement;
    style: string | object;
    center: [number, number];
    zoom: number;
    attributionControl: false;
  }) => MapInstance;
  Marker: new (options: { element: HTMLElement }) => MarkerInstance;
};

type ReactRoot = {
  render: (children: ReactNode) => void;
  unmount: () => void;
};

type CreateRoot = (container: Element | DocumentFragment) => ReactRoot;

/**
 * Full-screen MapLibre map. This is the homepage.
 *
 * Tiles come from OpenFreeMap (no auth required). Markers are rendered as
 * React components inside MapLibre `Marker` containers, and clustering is
 * driven by `supercluster` whenever more than 50 sites are visible.
 */
export function WaterVoiceMap() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => setIsMounted(true), []);

  if (!isMounted) return <MapSkeleton />;

  return <WaterVoiceMapClient />;
}

function WaterVoiceMapClient() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const mlRef = useRef<MapLibreClient | null>(null);
  const createRootRef = useRef<CreateRoot | null>(null);
  const markerRegistry = useRef<Map<string, { marker: MarkerInstance; root: ReactRoot }>>(
    new Map(),
  );
  const nettleMarkerRegistry = useRef<Map<string, { marker: MarkerInstance; root: ReactRoot }>>(
    new Map(),
  );
  const userLocationMarker = useRef<MarkerInstance | null>(null);
  // Last user-driven viewport (pan/zoom that wasn't caused by selecting a
  // location). Defaults to the initial map load state. When a selection is
  // cleared, the map flies back to this viewport. It does NOT update while
  // a selection is active, so selecting a new location does not overwrite it.
  const savedViewportRef = useRef<{ center: [number, number]; zoom: number }>({
    center: DC_CENTER,
    zoom: 12,
  });
  const hasSelectionRef = useRef(false);
  // Undo state for filter-driven selection clears
  const prevFilterForUndoRef = useRef<SiteTypeFilter>("all");
  const prevSelectedSiteForUndoRef = useRef<SiteFeature | null>(null);

  const [isDark, setIsDark] = useState(false);
  // Basemap style — reads localStorage on mount; defaults to 'dark' when the
  // OS dark-mode preference is detected and no preference has been saved yet.
  const [mapStyle, setMapStyle] = useState<MapStyleMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStyleMode | null;
      if (saved === "map" || saved === "dark" || saved === "satellite") return saved;
    }
    return "map"; // resolved to 'dark' after isDark is known — see effect below
  });
  const [filter, setFilter] = useState<SiteTypeFilter>("all");
  const [sites, setSites] = useState<SiteFeature[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteFeature | null>(null);
  const [zoomCommand, setZoomCommand] = useState<"in" | "out" | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);
  const [, force] = useState(0);
  const [pulseSiteId, setPulseSiteId] = useState<string | null>(null);
  const [mapClickToken, setMapClickToken] = useState(0);
  const [selectedPlaceLabel, setSelectedPlaceLabel] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState<"idle" | "picking" | "form">("idle");
  const [pendingLngLat, setPendingLngLat] = useState<[number, number] | null>(null);
  const [mySpotsPanelOpen, setMySpotsPanelOpen] = useState(false);
  const [userSites, setUserSites] = useState<PersonalSite[]>([]);
  const [showSeaNettles, setShowSeaNettles] = useState(false);
  const nettleObservations = useSeaNettleData(showSeaNettles);
  const [userSitesLoading, setUserSitesLoading] = useState(false);

  const { user } = useAuth();
  const doListUserSites = useServerFn(listUserSites);

  // Listen for the avatar-menu "My spots" click dispatched by AuthNav.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setMySpotsPanelOpen(true);
    window.addEventListener("watervoice:open-my-spots", handler);
    return () => window.removeEventListener("watervoice:open-my-spots", handler);
  }, []);

  // Fetch the logged-in user's personal sites via supabaseAdmin (bypasses RLS
  // so owner_id is always present; the RPC omits this column from its RETURNS).
  const loadUserSites = useCallback(() => {
    setUserSitesLoading(true);
    doListUserSites()
      .then((data) => setUserSites(data))
      .catch((err) => console.error("[map] failed to load user sites", err))
      .finally(() => setUserSitesLoading(false));
  }, [doListUserSites]);

  useEffect(() => {
    if (user) loadUserSites();
    else setUserSites([]);
  }, [user, loadUserSites]);

  const personalSiteIds = useMemo(() => new Set(userSites.map((s) => s.id)), [userSites]);

  // Keep hasSelectionRef in sync with selection state so the moveend handler
  // (registered once at map init) can read the latest value.
  useEffect(() => {
    hasSelectionRef.current = selectedSite !== null || selectedPlaceLabel !== null;
  }, [selectedSite, selectedPlaceLabel]);
  // Splash screen: hide after map loads
  const [splashVisible, setSplashVisible] = useState(true);

  /**
   * Compute a pixel offset for flyTo so the target pin lands in the
   * portion of the map that is NOT covered by the info panel.
   *
   * Mobile: panel slides up from above the bottom search pill, ~45dvh tall.
   *   → shift target upward (negative y) so the pin sits in the visible
   *     top half of the map.
   * Desktop: panel is left-aligned, ~420px wide, fixed height.
   *   → shift target right (positive x) so the pin sits in the visible
   *     right portion of the map.
   */
  const getPanelOffset = useCallback((): [number, number] => {
    if (typeof window === "undefined") return [0, 0];
    const container = mapContainerRef.current;
    const h = container?.clientHeight ?? window.innerHeight;
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) {
      // Panel ~420px wide on the left → shift target ~half-panel right.
      return [210, 0];
    }
    // Mobile: pill stack at bottom ≈ 120px, panel ≈ 45dvh above it.
    const panelBottomGap = 120;
    const panelHeight = h * 0.45;
    const visibleCenterY = (h - panelBottomGap - panelHeight) / 2;
    const offsetY = visibleCenterY - h / 2;
    return [0, offsetY];
  }, []);

  /**
   * Clear the current selection (site or place) and fly the map back to
   * the last user-driven viewport. Used by the bottom-sheet close button
   * and by filter changes that hide the currently selected site.
   */
  const clearSelection = useCallback(() => {
    setSelectedSite(null);
    setSelectedPlaceLabel(null);
    const map = mapRef.current;
    if (map) {
      const { center, zoom } = savedViewportRef.current;
      map.flyTo({ center, zoom, duration: 800 });
    }
  }, []);

  /**
   * Filter change handler: if the currently selected site's type is not
   * included by the new filter, clear the selection (same behavior as the
   * user tapping the info-panel close button).
   */
  const handleFilterChange = useCallback(
    (next: SiteTypeFilter) => {
      setFilter(next);
      if (selectedSite && next !== "all" && selectedSite.properties.site_type !== next) {
        // stash undo state before clearing
        prevFilterForUndoRef.current = filter;
        prevSelectedSiteForUndoRef.current = selectedSite;

        const prevOpt = FILTER_OPTIONS.find((o) => o.value === filter) ?? FILTER_OPTIONS[0];
        const PrevIcon =
          prevOpt.value === "all" ? Grid3X3 : SITE_TYPE_ICONS[prevOpt.value as SiteType];

        const toastId = toast("Selection cleared", {
          description: (
            <div className="flex flex-col gap-2">
              <span>
                &ldquo;{selectedSite.properties.name}&rdquo; is hidden by the current filter.
              </span>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md px-3 py-1.5 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-900/30"
                onClick={() => {
                  toast.dismiss(toastId);
                  setFilter(prevFilterForUndoRef.current);
                  const site = prevSelectedSiteForUndoRef.current;
                  if (site) {
                    setSelectedSite(site);
                    setPulseSiteId(site.properties.id);
                    const map = mapRef.current;
                    if (map) {
                      const [x, y] = getPanelOffset();
                      map.flyTo({
                        center: site.geometry.coordinates as [number, number],
                        zoom: 15,
                        duration: 800,
                        offset: [x, y],
                      });
                    }
                  }
                }}
              >
                <Undo size={14} aria-hidden />
                Back to {prevOpt.label}
                <PrevIcon size={14} aria-hidden />
              </button>
            </div>
          ),
        });
        clearSelection();
      }
    },
    [selectedSite, clearSelection, filter, getPanelOffset],
  );

  // --- dark mode detection ---------------------------------------------------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // --- map init (client-only, dynamic imports) ------------------------------
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;

    void (async () => {
      // Keep MapLibre and its CSS out of server rendering entirely.
      const [{ default: maplibregl }, { createRoot }] = await Promise.all([
        import("maplibre-gl"),
        import("react-dom/client"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);

      if (cancelled || !mapContainerRef.current) return;

      const maplibreClient = maplibregl as unknown as MapLibreClient;
      mlRef.current = maplibreClient;
      createRootRef.current = createRoot as unknown as CreateRoot;

      const map = new maplibreClient.Map({
        container: mapContainerRef.current,
        style: CARTO_LIGHT_STYLE,
        center: DC_CENTER,
        zoom: 12,
        attributionControl: false,
      });
      mapRef.current = map;
      console.log("Map initialized");

      map.on("error", (e) => {
        console.warn("Map tile error:", (e as { error?: { message?: string } }).error?.message);
      });

      const triggerRecluster = () => force((n) => n + 1);
      map.on("moveend", (...args: unknown[]) => {
        const e = args[0] as { originalEvent?: unknown } | undefined;
        triggerRecluster();
        // Capture as "last custom viewport" whenever the user drives the map
        // (pan, zoom, drag). `originalEvent` is only present on user gestures;
        // programmatic flyTo/easeTo calls omit it, so those don't overwrite
        // the saved viewport.
        if (e?.originalEvent) {
          const c = map.getCenter();
          savedViewportRef.current = {
            center: [c.lng, c.lat],
            zoom: map.getZoom(),
          };
        }
      });
      map.on("zoomend", triggerRecluster);
      map.on("load", () => {
        triggerRecluster();
        // Hide splash once the map tiles are ready
        setSplashVisible(false);
      });
      map.on("click", () => setMapClickToken((n) => n + 1));
      triggerRecluster();

      // If geolocation already granted, recenter on user at zoom 12.
      // Do NOT prompt for permission here.
      if (typeof navigator !== "undefined" && navigator.permissions && navigator.geolocation) {
        navigator.permissions
          .query({ name: "geolocation" as PermissionName })
          .then((status) => {
            if (status.state !== "granted") return;
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                map.flyTo({
                  center: [pos.coords.longitude, pos.coords.latitude],
                  zoom: 12,
                });
              },
              () => {},
            );
          })
          .catch(() => {});
      }
    })();

    const registry = markerRegistry.current;
    return () => {
      cancelled = true;
      for (const entry of registry.values()) {
        entry.root.unmount();
        entry.marker.remove();
      }
      registry.clear();
      userLocationMarker.current?.remove();
      userLocationMarker.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      mlRef.current = null;
      createRootRef.current = null;
    };
    // We intentionally init once; style swaps are handled below.
  }, []);

  // --- auto-detect dark mode and set initial map style if none saved ---------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (!saved && isDark) {
      // No user preference saved yet — follow the OS dark-mode preference.
      setMapStyle("dark");
    }
  }, [isDark]);

  // --- swap basemap when mapStyle changes ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapStyle === "satellite") {
      map.setStyle(ESRI_SATELLITE_STYLE);
    } else if (mapStyle === "dark") {
      map.setStyle(CARTO_DARK_STYLE);
    } else {
      map.setStyle(CARTO_LIGHT_STYLE);
    }
  }, [mapStyle]);

  /** Persist the user's basemap choice and apply it. */
  const handleMapStyleChange = (style: MapStyleMode) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(MAP_STYLE_STORAGE_KEY, style);
    }
    setMapStyle(style);
  };

  // --- data fetch ------------------------------------------------------------
  const loadSites = useCallback(() => {
    setLoadError(null);
    setSites(null);
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        const headers: HeadersInit = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        return fetch("/api/sites", { headers });
      })
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json() as Promise<SitesFeatureCollection>;
      })
      .then((fc) => setSites(fc.features))
      .catch((err) => {
        console.error("[map] failed to load sites", err);
        setLoadError("Could not load sites. Check your connection.");
      });
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  // Re-fetch sites on actual auth transitions so the map reflects the current
  // session immediately after sign-in or sign-out without a manual refresh.
  // Filtered to SIGNED_IN/SIGNED_OUT so token refreshes don't trigger extra
  // fetches. On SIGNED_OUT also clear personal-site state immediately.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        loadSites();
      } else if (event === "SIGNED_OUT") {
        loadSites();
        setUserSites([]);
        setMySpotsPanelOpen(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadSites]);

  // --- supercluster setup ----------------------------------------------------
  const visibleSites = useMemo(
    () => (sites ? filterSitesByType(sites, filter) : []),
    [sites, filter],
  );

  const cluster = useMemo(() => {
    const sc = new Supercluster<SiteFeature["properties"]>({
      radius: 60,
      maxZoom: 16,
      minPoints: 50, // cluster only when >50 markers
    });
    sc.load(visibleSites as unknown as GeoJSON.Feature<GeoJSON.Point, SiteFeature["properties"]>[]);
    return sc;
  }, [visibleSites]);

  // --- render markers (and clusters) ----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mlRef.current;
    const createRoot = createRootRef.current;
    if (!map || !maplibregl || !createRoot) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const zoom = Math.round(map.getZoom());
    const clusters = cluster.getClusters(bbox, zoom);

    const present = new Set<string>();

    for (const c of clusters) {
      const [lng, lat] = c.geometry.coordinates as [number, number];
      const isClusterPoint = (c.properties as { cluster?: boolean }).cluster;

      if (isClusterPoint) {
        const key = `cluster-${c.id}`;
        present.add(key);
        const count = (c.properties as { point_count: number }).point_count;
        const existing = markerRegistry.current.get(key);
        if (existing) {
          existing.marker.setLngLat([lng, lat]);
          existing.root.render(<ClusterBubble count={count} />);
        } else {
          const el = document.createElement("div");
          const root = createRoot(el);
          root.render(<ClusterBubble count={count} />);
          const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          markerRegistry.current.set(key, { marker, root });
        }
      } else {
        const props = c.properties as SiteFeature["properties"];
        const key = `site-${props.id}`;
        present.add(key);
        const feature: SiteFeature = {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: props,
        };
        const node = (
          <SiteMarker
            status={props.status}
            siteType={props.site_type}
            stale={props.stale}
            isDark={isDark}
            label={props.name}
            pulse={pulseSiteId === props.id}
            selected={selectedSite?.properties.id === props.id}
            personal={props.owner_id != null}
            onClick={() => {
              mapRef.current?.flyTo({
                center: [lng, lat],
                zoom: Math.max(mapRef.current.getZoom?.() ?? 13, 13),
                duration: 800,
                offset: getPanelOffset(),
              });
              setSelectedSite(feature);
              setSelectedPlaceLabel(null);
            }}
          />
        );
        const existing = markerRegistry.current.get(key);
        if (existing) {
          existing.marker.setLngLat([lng, lat]);
          existing.root.render(node);
        } else {
          const el = document.createElement("div");
          el.style.transition = "opacity 200ms";
          const root = createRoot(el);
          root.render(node);
          const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          markerRegistry.current.set(key, { marker, root });
        }
      }
    }

    // Remove markers that are no longer in view / filtered out.
    for (const [key, entry] of markerRegistry.current) {
      if (!present.has(key)) {
        entry.root.unmount();
        entry.marker.remove();
        markerRegistry.current.delete(key);
      }
    }
  });

  // Sea nettle buoy layer — a separate, unclustered marker registry (a
  // handful of CBIBS stations, not hundreds of sites). Independent effect so
  // toggling it never touches the site-clustering pass above.
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mlRef.current;
    const createRoot = createRootRef.current;
    if (!map || !maplibregl || !createRoot) return;

    if (!showSeaNettles) {
      for (const entry of nettleMarkerRegistry.current.values()) {
        entry.root.unmount();
        entry.marker.remove();
      }
      nettleMarkerRegistry.current.clear();
      return;
    }

    const present = new Set<string>();
    for (const obs of nettleObservations) {
      present.add(obs.stationCode);
      const node = <SeaNettleMarker observation={obs} />;
      const existing = nettleMarkerRegistry.current.get(obs.stationCode);
      if (existing) {
        existing.root.render(node);
      } else {
        const el = document.createElement("div");
        const root = createRoot(el);
        root.render(node);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([obs.lng, obs.lat])
          .addTo(map);
        nettleMarkerRegistry.current.set(obs.stationCode, { marker, root });
      }
    }

    for (const [key, entry] of nettleMarkerRegistry.current) {
      if (!present.has(key)) {
        entry.root.unmount();
        entry.marker.remove();
        nettleMarkerRegistry.current.delete(key);
      }
    }
  }, [showSeaNettles, nettleObservations]);

  // Enabling the layer confirms itself with a toast. The flag is read from
  // state rather than inside the setState updater so the toast fires exactly
  // once per tap (updaters can run twice under StrictMode).
  const handleSeaNettleToggle = useCallback(() => {
    const next = !showSeaNettles;
    setShowSeaNettles(next);
    if (next) toast(NETTLE_TOAST.showing);
  }, [showSeaNettles]);

  // --- controls --------------------------------------------------------------
  useEffect(() => {
    if (!zoomCommand) return;
    const map = mapRef.current;
    if (zoomCommand === "in") map?.zoomIn();
    if (zoomCommand === "out") map?.zoomOut();
    setZoomCommand(null);
  }, [zoomCommand]);

  useEffect(() => {
    if (locateRequest === 0) return;
    const maplibregl = mlRef.current;
    const map = mapRef.current;
    if (!navigator.geolocation || !map || !maplibregl) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        map.flyTo({ center: lngLat, zoom: 13 });

        if (userLocationMarker.current) userLocationMarker.current.remove();
        const el = document.createElement("div");
        el.setAttribute("data-testid", "user-location");
        el.className = "watervoice-user-dot";
        userLocationMarker.current = new maplibregl.Marker({ element: el })
          .setLngLat(lngLat)
          .addTo(map);
      },
      (err) => console.warn("[map] geolocation denied", err),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [locateRequest]);

  return (
    <div className="relative w-full" style={{ height: "100dvh" }}>
      <div
        ref={mapContainerRef}
        data-testid="watervoice-map"
        role="region"
        aria-label="Water quality map"
        className="absolute inset-0"
        style={{ height: "calc(100dvh - 64px)", width: "100%" }}
      />

      <MapTopControls
        sites={sites ?? []}
        getCenter={() => {
          const c = mapRef.current?.getCenter();
          return c ? [c.lng, c.lat] : DC_CENTER;
        }}
        onSelectSite={(site) => {
          const [lng, lat] = site.geometry.coordinates;
          mapRef.current?.flyTo({
            center: [lng, lat],
            zoom: 15,
            duration: 1000,
            offset: getPanelOffset(),
          });
          setSelectedSite(site);
          setSelectedPlaceLabel(null);
          setPulseSiteId(site.properties.id);
          setTimeout(() => {
            setPulseSiteId((cur) => (cur === site.properties.id ? null : cur));
          }, 3000);
        }}
        onSelectPlace={(place) => {
          mapRef.current?.flyTo({
            center: [place.lon, place.lat],
            zoom: 13,
            duration: 1000,
            offset: getPanelOffset(),
          });
          setSelectedPlaceLabel(place.short_name);
          setSelectedSite(null);
        }}
        mapClickToken={mapClickToken}
        filter={filter}
        onFilterChange={handleFilterChange}
        selectedDisplay={
          selectedSite
            ? {
                kind: "site",
                name: selectedSite.properties.name,
                siteType: selectedSite.properties.site_type,
                siteId: selectedSite.properties.id,
              }
            : selectedPlaceLabel
              ? { kind: "place", name: selectedPlaceLabel }
              : null
        }
      />

      {/* Zoom / locate controls — vertically centered right edge */}
      <div className="pointer-events-none absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        <div className="pointer-events-auto flex flex-col gap-2">
          <ControlButton
            aria-label="Zoom in"
            className="rounded-full"
            onClick={() => setZoomCommand("in")}
          >
            <Plus size={18} aria-hidden />
          </ControlButton>
          <ControlButton
            aria-label="Zoom out"
            className="rounded-full"
            onClick={() => setZoomCommand("out")}
          >
            <Minus size={18} aria-hidden />
          </ControlButton>
          <ControlButton
            aria-label="Find my location"
            className="rounded-full"
            data-testid="locate-me"
            onClick={() => setLocateRequest((n) => n + 1)}
          >
            <Crosshair size={18} aria-hidden />
          </ControlButton>
        </div>
      </div>

      {/* Layers / style switcher above the search/filter row */}
      <div
        className="pointer-events-none absolute right-4 z-20"
        style={{
          bottom:
            "calc(64px + env(safe-area-inset-bottom) + 12px + 44px + 8px + var(--focus-group-bar-height, 0px))",
        }}
      >
        <MapStyleSwitcher currentStyle={mapStyle} onChange={handleMapStyleChange} />
      </div>

      {/* Jellyfish layer toggle, stacked above the style switcher.
          z-10 keeps it below the style switcher's popover (z-20 wrapper). */}
      <div
        className="pointer-events-none absolute right-4 z-10"
        style={{
          bottom:
            "calc(64px + env(safe-area-inset-bottom) + 12px + 44px + 8px + 44px + 8px + var(--focus-group-bar-height, 0px))",
        }}
      >
        <div className="pointer-events-auto">
          <SeaNettleToggle active={showSeaNettles} onToggle={handleSeaNettleToggle} />
        </div>
      </div>

      {sites === null && !loadError && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="rounded-lg bg-card px-5 py-4 text-sm text-card-foreground shadow-lg ring-1 ring-border">
            Loading water quality data…
          </div>
        </div>
      )}
      {loadError && (
        <div className="pointer-events-auto absolute inset-0 z-10 grid place-items-center">
          <div className="max-w-sm rounded-lg bg-card px-5 py-4 text-center text-sm shadow-lg ring-1 ring-border">
            <p className="text-card-foreground">{loadError}</p>
            <button
              type="button"
              onClick={loadSites}
              className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <SiteBottomSheet
        site={selectedSite}
        onClose={clearSelection}
        personalSiteIds={personalSiteIds}
        onSiteDeleted={() => {
          clearSelection();
          loadSites();
          loadUserSites();
        }}
        onSiteUpdated={() => {
          loadSites();
        }}
      />

      {/* Placement mode — crosshair overlay and banner */}
      {placementMode === "picking" && (
        <>
          {/* Crosshair at map center */}
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-full bg-violet-600 p-1 shadow-lg ring-4 ring-white/60">
              <MapPin size={22} color="#ffffff" strokeWidth={2.5} />
            </div>
          </div>

          {/* Top banner */}
          <div
            className="pointer-events-auto absolute left-4 right-4 z-30 flex items-center justify-between gap-2 rounded-xl bg-card/95 px-4 py-3 shadow-lg ring-1 ring-border dark:bg-gray-900/95"
            style={{ top: "16px" }}
          >
            <p className="text-sm font-medium dark:text-white">Pan the map to your spot</p>
            <button
              type="button"
              onClick={() => setPlacementMode("idle")}
              className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          {/* "Place here" button — above the search/filter row */}
          <div
            className="pointer-events-auto absolute left-1/2 z-30 -translate-x-1/2"
            style={{
              bottom:
                "calc(64px + env(safe-area-inset-bottom) + 12px + 44px + 16px + var(--focus-group-bar-height, 0px))",
            }}
          >
            <button
              type="button"
              onClick={() => {
                const center = mapRef.current?.getCenter();
                if (!center) return;
                setPendingLngLat([center.lng, center.lat]);
                setPlacementMode("form");
              }}
              className="flex items-center gap-2 rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-xl hover:bg-violet-700 active:scale-95"
            >
              <MapPin size={16} aria-hidden />
              Place here
            </button>
          </div>
        </>
      )}

      {/* Create-site form sheet */}
      {placementMode === "form" && pendingLngLat && (
        <CreateSiteSheet
          lngLat={pendingLngLat}
          onClose={() => setPlacementMode("idle")}
          onCreated={(_, lngLat) => {
            setPlacementMode("idle");
            setPendingLngLat(null);
            loadSites();
            loadUserSites();
            mapRef.current?.flyTo({ center: lngLat, zoom: 15, duration: 800 });
          }}
        />
      )}

      {/* My spots panel — opened from the avatar dropdown "My spots" menu item */}
      {mySpotsPanelOpen && (
        <MySpotsList
          sites={userSites}
          loading={userSitesLoading}
          onClose={() => setMySpotsPanelOpen(false)}
          onFlyTo={(lngLat, siteId) => {
            mapRef.current?.flyTo({
              center: lngLat,
              zoom: Math.max(mapRef.current.getZoom?.() ?? 15, 15),
              duration: 800,
              offset: getPanelOffset(),
            });
            const feature = sites?.find((s) => s.properties.id === siteId) ?? null;
            if (feature) {
              setSelectedSite(feature);
              setSelectedPlaceLabel(null);
            }
          }}
          onEnterPlacement={() => {
            clearSelection();
            setPlacementMode("picking");
          }}
          onRefresh={() => {
            loadSites();
            loadUserSites();
          }}
        />
      )}

      <SplashScreen isVisible={splashVisible} />

      {/* Pulsing user-location dot styles */}
      <style>{`
        .watervoice-user-dot {
          width: 18px; height: 18px; border-radius: 9999px;
          background: #14b8a6; box-shadow: 0 0 0 4px rgba(20,184,166,0.25);
          position: relative;
        }
        .watervoice-user-dot::after {
          content: ""; position: absolute; inset: -6px; border-radius: 9999px;
          background: rgba(20,184,166,0.35);
          animation: watervoice-pulse 1.8s ease-out infinite;
        }
        @keyframes watervoice-pulse {
          0% { transform: scale(0.7); opacity: 0.8; }
          100% { transform: scale(2); opacity: 0; }
        }
        .watervoice-marker-pulse {
          box-shadow: 0 0 0 0 rgba(20,184,166,0.6);
          animation: watervoice-marker-pulse 1.2s ease-out infinite;
        }
        @keyframes watervoice-marker-pulse {
          0% { box-shadow: 0 0 0 0 rgba(20,184,166,0.7); }
          100% { box-shadow: 0 0 0 16px rgba(20,184,166,0); }
        }
      `}</style>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div
      data-testid="watervoice-map-skeleton"
      aria-label="Loading map"
      className="relative w-full overflow-hidden"
      style={{
        height: "100dvh",
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--background) 70%, #14b8a6), color-mix(in oklab, var(--primary) 22%, #0f766e))",
      }}
    >
      <div className="absolute inset-0 animate-pulse bg-primary/10" />
      <div className="absolute left-4 right-4 top-20 h-20 rounded-lg bg-background/35 shadow-sm ring-1 ring-border/40" />
      <div className="absolute bottom-6 left-4 right-4 h-10 rounded-full bg-background/45 shadow-sm ring-1 ring-border/40" />
    </div>
  );
}

function ControlButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-md bg-white/75 text-primary shadow-md ring-1 ring-black/20 transition-colors hover:bg-white/90 hover:text-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600 dark:bg-gray-900/75 dark:ring-white/25 dark:hover:bg-teal-900/30 dark:hover:text-teal-300",
        className,
      )}
    />
  );
}

function ClusterBubble({ count }: { count: number }) {
  return (
    <div
      data-testid="cluster-bubble"
      className="grid h-11 w-11 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md ring-2 ring-white"
    >
      {count}
    </div>
  );
}
