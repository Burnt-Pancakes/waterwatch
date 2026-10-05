import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RouteBuilderPanel } from "@/components/plan/RouteBuilderPanel";
import { StepIndicator } from "@/components/plan/StepIndicator";
import { TripPlannerMap } from "@/components/plan/TripPlannerMap";
import { TripTimelinePanel } from "@/components/plan/TripTimelinePanel";
import { WindowFinderPanel } from "@/components/plan/WindowFinderPanel";
import { useAuth } from "@/hooks/use-auth";
import {
  buildSimpleMilestones,
  buildTimelineMilestones,
  calculateWaypoints,
  DEFAULT_NOAA_STATION,
  applyRouteDistances,
  estimateOneWayTravelMinutes,
  findBestDeparture,
  getWaterwayRoute,
  hasTidalDataForRoute,
  loadTripPlannerSites,
  parseShareParams,
  pickDisplayWindows,
  routeResultToSegments,
  saveTrip,
  siteToWaypoint,
  type DepartureWindow,
  type PlannerStep,
  type ScenicWaterRoute,
  type TimelineMilestone,
  type TripPlannerSite,
  type TripType,
  type TripWaypoint,
  WaterRouteRequestError,
} from "@/lib/tripPlanner";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Plan a trip — WaterWatch DMV" },
      { property: "og:description", content: "Plan a tidal-aware kayak trip between water access sites in the DC Metro area." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Plan a trip — WaterWatch DMV" },
      {
        name: "description",
        content: "Plan a tidal-aware kayak trip between water access sites in the DC Metro area.",
      },
    ],
  }),
  component: PlanPage,
});

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

function PlanPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<PlannerStep>("route");
  const [sites, setSites] = useState<TripPlannerSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [showAllSites, setShowAllSites] = useState(false);

  const [waypoints, setWaypoints] = useState<TripWaypoint[]>([]);
  const [tripType, setTripType] = useState<TripType>("out_and_back");
  const [speedKnots, setSpeedKnots] = useState(3);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [windows, setWindows] = useState<DepartureWindow[]>([]);
  const [windowsLoading, setWindowsLoading] = useState(false);
  const [windowsError, setWindowsError] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<DepartureWindow | null>(null);
  const [milestones, setMilestones] = useState<TimelineMilestone[]>([]);
  const [computedWaypoints, setComputedWaypoints] = useState<TripWaypoint[]>([]);
  const [waterRoute, setWaterRoute] = useState<ScenicWaterRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routingError, setRoutingError] = useState<WaterRouteRequestError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWindows([]);
    setSelectedWindow(null);
    setMilestones([]);
    setComputedWaypoints([]);

    if (waypoints.length < 2) {
      setWaterRoute(null);
      setRoutingError(null);
      setRouteLoading(false);
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    setWaterRoute(null);
    setRoutingError(null);
    const controller = new AbortController();

    void getWaterwayRoute(waypoints, { signal: controller.signal })
      .then((route) => {
        if (cancelled) return;
        setWaterRoute(route);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWaterRoute(null);
          setRoutingError(
            error instanceof WaterRouteRequestError
              ? error
              : new WaterRouteRequestError(
                  "ROUTING_DATA_UNAVAILABLE",
                  null,
                  "Verified water routing is temporarily unavailable.",
                ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [waypoints]);

  const routeCoordinates = waterRoute?.coordinates ?? [];
  const routeSegments = useMemo(() => routeResultToSegments(waterRoute), [waterRoute]);
  const routedWaypoints = useMemo(
    () => applyRouteDistances(waypoints, routeSegments),
    [waypoints, routeSegments],
  );
  const accessConnectors = useMemo(
    () => waterRoute?.legs.flatMap((leg) => leg.accessConnectors) ?? [],
    [waterRoute],
  );

  const skipTidalWindows = useMemo(() => !hasTidalDataForRoute(waypoints), [waypoints]);

  const visibleSites = useMemo(
    () => (showAllSites ? sites : sites.filter((s) => s.is_tidal)),
    [sites, showAllSites],
  );

  const loadSites = useCallback(() => {
    setSitesLoading(true);
    setSitesError(null);
    void loadTripPlannerSites()
      .then(setSites)
      .catch(() => setSitesError("Could not load sites. Check your connection and try again."))
      .finally(() => setSitesLoading(false));
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    if (typeof window === "undefined" || sites.length === 0) return;
    const params = parseShareParams(window.location.search);
    if (!params.origin || !params.dest) return;
    const origin = sites.find((s) => s.slug === params.origin);
    const dest = sites.find((s) => s.slug === params.dest);
    if (!origin || !dest) return;
    setWaypoints([siteToWaypoint(origin, 0), siteToWaypoint(dest, 1)]);
    if (params.type) setTripType(params.type);
  }, [sites]);

  const handleSiteSelect = (site: TripPlannerSite) => {
    setWaypoints((prev) => {
      const next = [...prev, siteToWaypoint(site, prev.length)];
      const label = CIRCLED[next.length - 1] ?? String(next.length);
      toast.success(`${site.name} added as waypoint ${label}`);
      return next;
    });
  };

  const goToTimelineWithoutWindows = useCallback(async () => {
    const departure = new Date();
    try {
      const computed = await calculateWaypoints(routedWaypoints, departure, speedKnots);
      setComputedWaypoints(computed);
      setMilestones(buildSimpleMilestones(computed));
      setSelectedWindow(null);
      setStep("timeline");
    } catch {
      toast.error("Could not build trip timeline. Try again.");
    }
  }, [routedWaypoints, speedKnots]);

  const fetchWindows = useCallback(async () => {
    if (waypoints.length < 2) return;
    setWindowsLoading(true);
    setWindowsError(null);
    setWindows([]);

    const firstWp = waypoints[0];
    const lastWp = waypoints[waypoints.length - 1];
    const firstSite = sites.find((s) => s.id === firstWp.site_id);
    const lastSite = sites.find((s) => s.id === lastWp.site_id);
    const originStation = firstSite
      ? (firstSite.tidal_gauge_station_id ??
        (firstSite.is_tidal ? DEFAULT_NOAA_STATION : undefined))
      : firstWp.noaa_station_id;
    const destStation = lastSite
      ? (lastSite.tidal_gauge_station_id ?? (lastSite.is_tidal ? DEFAULT_NOAA_STATION : undefined))
      : lastWp.noaa_station_id;

    if (!originStation || !destStation) {
      setWindowsLoading(false);
      await goToTimelineWithoutWindows();
      return;
    }

    const travelMinutes = estimateOneWayTravelMinutes(routedWaypoints, speedKnots, routeSegments);

    try {
      const results = await findBestDeparture(
        originStation,
        destStation,
        selectedDate,
        travelMinutes,
        speedKnots,
      );
      setWindows(pickDisplayWindows(results));
      setStep("windows");
    } catch {
      setWindowsError("Could not load tidal windows. Check your connection and try again.");
    } finally {
      setWindowsLoading(false);
    }
  }, [
    waypoints,
    routedWaypoints,
    routeSegments,
    selectedDate,
    speedKnots,
    sites,
    goToTimelineWithoutWindows,
  ]);

  const handleFindWindows = () => {
    if (!waterRoute || routeLoading || routingError) return;
    if (skipTidalWindows) {
      void goToTimelineWithoutWindows();
      return;
    }
    void fetchWindows();
  };

  const handleSelectWindow = async (window: DepartureWindow) => {
    setSelectedWindow(window);
    try {
      const departure = new Date(window.departure_time);
      const computed = await calculateWaypoints(routedWaypoints, departure, speedKnots);
      setComputedWaypoints(computed);
      setMilestones(buildTimelineMilestones(computed, window, tripType));
      setStep("timeline");
    } catch {
      toast.error("Could not build trip timeline. Try again.");
    }
  };

  const handleSave = async () => {
    if (!user || waypoints.length < 2 || !waterRoute) return;
    setSaving(true);
    try {
      const launch = waypoints[0];
      const dest = waypoints[waypoints.length - 1];
      await saveTrip({
        name: `${launch.name} → ${dest.name}`,
        trip_type: tripType,
        departure_time: selectedWindow?.departure_time,
        paddling_speed_knots: speedKnots,
        waypoints: computedWaypoints.length ? computedWaypoints : waypoints,
      });
      toast.success("Trip saved");
    } catch {
      toast.error("Could not save trip");
    } finally {
      setSaving(false);
    }
  };

  const originName = waypoints[0]?.name ?? "Launch";
  const destName = waypoints[waypoints.length - 1]?.name ?? "Destination";

  return (
    <div
      className="flex min-h-screen flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom)+var(--focus-group-bar-height,0px))]"
      data-testid="plan-page"
    >
      <header className="border-b border-border bg-card px-4 py-3">
        <h1 className="text-lg font-semibold text-[#1A3A5C] dark:text-foreground">Plan a trip</h1>
      </header>

      <StepIndicator
        current={step}
        onStepClick={(s) => {
          if (s === "route") setStep("route");
          if (s === "windows" && waterRoute && !routeLoading && windows.length > 0) {
            setStep("windows");
          }
          if (s === "timeline" && waterRoute && !routeLoading && milestones.length > 0) {
            setStep("timeline");
          }
        }}
      />

      {sitesError && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          {sitesError}
          <button type="button" className="ml-2 underline" onClick={loadSites}>
            Retry
          </button>
        </div>
      )}

      {step === "route" && (
        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)] lg:items-start">
          <div className="min-w-0 lg:sticky lg:top-0">
            {sitesLoading ? (
              <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground lg:h-[calc(100vh-9rem)] lg:min-h-[560px]">
                Loading map…
              </div>
            ) : (
              <TripPlannerMap
                sites={visibleSites}
                waypoints={waypoints}
                routeCoordinates={routeCoordinates}
                accessConnectors={accessConnectors}
                onSiteSelect={handleSiteSelect}
                className="h-[50vh] min-h-[320px] w-full lg:h-[calc(100vh-9rem)] lg:min-h-[560px]"
                fitToRoute={waypoints.length >= 2}
              />
            )}
          </div>
          <div className="min-w-0 border-t border-border lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:border-l lg:border-t-0">
            <RouteBuilderPanel
              sites={visibleSites}
              waypoints={waypoints}
              route={waterRoute}
              routeSegments={routeSegments}
              routeLoading={routeLoading}
              routingError={routingError}
              tripType={tripType}
              speedKnots={speedKnots}
              showAllSites={showAllSites}
              onShowAllSitesChange={setShowAllSites}
              onWaypointsChange={setWaypoints}
              onTripTypeChange={setTripType}
              onSpeedChange={setSpeedKnots}
              onFindWindows={handleFindWindows}
              canFindWindows={
                waypoints.length >= 2 && !sitesLoading && !routeLoading && Boolean(waterRoute)
              }
              skipTidalWindows={skipTidalWindows}
            />
          </div>
        </div>
      )}

      {step === "windows" && (
        <WindowFinderPanel
          originName={originName}
          destName={destName}
          selectedDate={selectedDate}
          onDateChange={(d) => {
            setSelectedDate(d);
            void fetchWindows();
          }}
          windows={windows}
          loading={windowsLoading}
          error={windowsError}
          onRetry={() => void fetchWindows()}
          onSelectWindow={(w) => void handleSelectWindow(w)}
        />
      )}

      {step === "timeline" && (
        <TripTimelinePanel
          sites={sites}
          waypoints={waypoints}
          routeCoordinates={routeCoordinates}
          accessConnectors={accessConnectors}
          routeSegments={routeSegments}
          route={waterRoute}
          tripType={tripType}
          speedKnots={speedKnots}
          selectedWindow={selectedWindow}
          milestones={milestones}
          windowQuality={selectedWindow?.window_quality}
          authenticated={Boolean(user)}
          onChangeWindow={() => setStep(skipTidalWindows ? "route" : "windows")}
          onSave={handleSave}
          saving={saving}
          noTidalData={skipTidalWindows}
        />
      )}
    </div>
  );
}
