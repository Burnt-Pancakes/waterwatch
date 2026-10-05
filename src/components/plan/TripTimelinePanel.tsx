import { Link } from "@tanstack/react-router";
import { ArrowDown, Clock } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TripPlannerMap } from "@/components/plan/TripPlannerMap";
import {
  TRIP_TYPE_LABELS,
  buildShareUrl,
  computeLegStats,
  formatDistance,
  formatPlannerDate,
  formatPlannerTime,
  formatTravelTime,
  getWindowQualityPresentation,
  type DepartureWindow,
  type ScenicWaterRoute,
  type TimelineMilestone,
  type TripPlannerSite,
  type TripType,
  type TripWaypoint,
  type WaterRouteSegment,
  type WindowQuality,
} from "@/lib/tripPlanner";

interface TripTimelinePanelProps {
  sites: TripPlannerSite[];
  waypoints: TripWaypoint[];
  routeCoordinates?: [number, number][];
  accessConnectors?: [number, number][][];
  routeSegments?: WaterRouteSegment[];
  route?: ScenicWaterRoute | null;
  tripType: TripType;
  speedKnots: number;
  selectedWindow: DepartureWindow | null;
  milestones: TimelineMilestone[];
  windowQuality?: WindowQuality;
  authenticated: boolean;
  onChangeWindow: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
  noTidalData: boolean;
}

function TideArrow({ direction }: { direction?: string | null }) {
  if (direction === "Flooding") return <span className="text-teal-700">↗ Flooding</span>;
  if (direction === "Ebbing") return <span className="text-teal-700">↘ Ebbing</span>;
  return <span className="text-muted-foreground">No tidal data</span>;
}

export function TripTimelinePanel({
  sites,
  waypoints,
  routeCoordinates,
  accessConnectors,
  routeSegments,
  route,
  tripType,
  speedKnots,
  selectedWindow,
  milestones,
  windowQuality,
  authenticated,
  onChangeWindow,
  onSave,
  saving,
  noTidalData,
}: TripTimelinePanelProps) {
  const stats = computeLegStats(waypoints, speedKnots, tripType, routeSegments);
  const banner = windowQuality ? getWindowQualityPresentation(windowQuality) : null;
  const launch = waypoints[0];
  const dest = waypoints[waypoints.length - 1];

  const handleShare = async () => {
    if (!launch?.site_id || !dest?.site_id) return;
    const launchSite = sites.find((s) => s.id === launch.site_id);
    const destSite = sites.find((s) => s.id === dest.site_id);
    if (!launchSite || !destSite) return;
    const url = buildShareUrl(window.location.origin, {
      origin: launchSite.slug,
      dest: destSite.slug,
      depart: selectedWindow?.departure_time,
      type: tripType,
    });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <div
      className="space-y-4 bg-card p-4 pb-[calc(7rem+env(safe-area-inset-bottom)+var(--focus-group-bar-height,0px))]"
      data-testid="trip-timeline-panel"
    >
      {banner && !noTidalData && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${banner.bannerClass}`}>
          {windowQuality === "good" && "✅ "}
          {windowQuality === "fair" && "🟡 "}
          {windowQuality === "poor" && "⚠️ "}
          {banner.bannerText}
        </div>
      )}

      {noTidalData && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No tidal data for this location — distance and travel time only.
        </div>
      )}

      <TripPlannerMap
        sites={[]}
        waypoints={waypoints}
        routeCoordinates={routeCoordinates}
        accessConnectors={accessConnectors}
        interactive={false}
        className="h-[200px] w-full rounded-lg border border-border"
        fitToRoute
      />

      <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#1A3A5C]">
          Your trip plan
        </p>
        {selectedWindow && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPlannerDate(selectedWindow.departure_time)}
            {!noTidalData && banner ? ` · ${banner.shortLabel}` : ""}
          </p>
        )}
        <p className="mt-2 break-words font-medium">
          {launch?.name} → {dest?.name}
        </p>
        <p className="text-sm text-muted-foreground">
          {TRIP_TYPE_LABELS[tripType]} · {formatDistance(stats.roundTripDistanceNm)} · ~
          {formatTravelTime(stats.roundTripMinutes)}
        </p>
      </div>

      {route && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <p className="font-semibold">Scenic water route</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {route.scenicHighlights.slice(0, 3).map((highlight) => (
              <span
                key={highlight}
                className="rounded-full bg-white/70 px-2 py-1 text-[11px] dark:bg-black/20"
              >
                {highlight}
              </span>
            ))}
          </div>
          {route.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-0">
        {milestones.map((m, idx) => (
          <div key={`${m.kind}-${m.time}`} className="relative pl-8">
            {idx < milestones.length - 1 && (
              <span className="absolute bottom-0 left-[11px] top-8 w-px bg-border" aria-hidden />
            )}
            <span className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#1A3A5C] text-[10px] font-bold text-white">
              {idx + 1}
            </span>

            <div
              className={`mb-4 rounded-lg border border-border p-3 ${
                m.kind === "wait" ? "bg-amber-50 dark:bg-amber-950/40" : "bg-background"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-[10px] font-bold tracking-wider ${
                    m.kind === "arrive"
                      ? "text-teal-700"
                      : m.kind === "wait"
                        ? "text-amber-700"
                        : "text-[#1A3A5C]"
                  }`}
                >
                  {m.kind === "wait" && <Clock size={12} className="mr-1 inline" />}
                  {m.label}
                </p>
                <p className="text-sm font-medium">{formatPlannerTime(m.time)}</p>
              </div>
              <p className="mt-1 text-sm">{m.siteName}</p>
              {!noTidalData && (
                <p className="mt-1 text-sm">
                  <TideArrow direction={m.tideDirection} />
                  {m.tideHeightFt != null && ` · ${m.tideHeightFt} ft`}
                </p>
              )}
              {m.tideAssistNote && (
                <p className="mt-1 text-xs text-emerald-700">{m.tideAssistNote} ✓</p>
              )}
              {m.kind === "wait" && (
                <p className="mt-1 text-xs text-muted-foreground">Good time to rest or explore</p>
              )}
              {m.segmentDistanceNm != null && m.segmentMinutes != null && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDown size={12} />
                  {formatDistance(m.segmentDistanceNm)} · {formatTravelTime(m.segmentMinutes)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>Total paddle time: ~{formatTravelTime(stats.roundTripMinutes)}</p>
        {selectedWindow && (
          <p>
            Total trip time: ~
            {formatTravelTime(
              (new Date(selectedWindow.estimated_home_time).getTime() -
                new Date(selectedWindow.departure_time).getTime()) /
                60000,
            )}
          </p>
        )}
        {!noTidalData && <p className="mt-1">Tidal data: NOAA CO-OPS</p>}
        {route && (
          <p className="mt-1 break-words">Route data: OpenStreetMap · graph {route.dataVersion}</p>
        )}
      </div>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {authenticated ? (
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            {saving ? "Saving…" : "Save this trip"}
          </Button>
        ) : (
          <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
            <Link to="/auth/sign-in">Sign in to save this trip</Link>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleShare()}
          className="w-full sm:w-auto"
        >
          Share
        </Button>
        <Button type="button" variant="ghost" onClick={onChangeWindow} className="w-full sm:w-auto">
          ← Change window
        </Button>
      </div>
    </div>
  );
}
