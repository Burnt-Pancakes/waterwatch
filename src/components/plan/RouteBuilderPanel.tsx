import { useMemo, useState } from "react";
import { Leaf, LoaderCircle, Plus, TriangleAlert, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PADDLING_SPEED_OPTIONS,
  TRIP_TYPE_LABELS,
  computeLegStats,
  filterTripPlannerSites,
  formatDistance,
  formatTravelTime,
  siteToWaypoint,
  type ScenicWaterRoute,
  type TripPlannerSite,
  type TripType,
  type TripWaypoint,
  type WaterRouteSegment,
  type WaterRouteRequestError,
} from "@/lib/tripPlanner";

interface RouteBuilderPanelProps {
  sites: TripPlannerSite[];
  waypoints: TripWaypoint[];
  route?: ScenicWaterRoute | null;
  routeSegments?: WaterRouteSegment[];
  routeLoading?: boolean;
  routingError?: WaterRouteRequestError | null;
  tripType: TripType;
  speedKnots: number;
  showAllSites: boolean;
  onShowAllSitesChange: (v: boolean) => void;
  onWaypointsChange: (wps: TripWaypoint[]) => void;
  onTripTypeChange: (t: TripType) => void;
  onSpeedChange: (speed: number) => void;
  onFindWindows: () => void;
  canFindWindows: boolean;
  skipTidalWindows: boolean;
}

export function RouteBuilderPanel({
  sites,
  waypoints,
  route,
  routeSegments,
  routeLoading = false,
  routingError,
  tripType,
  speedKnots,
  showAllSites,
  onShowAllSitesChange,
  onWaypointsChange,
  onTripTypeChange,
  onSpeedChange,
  onFindWindows,
  canFindWindows,
  skipTidalWindows,
}: RouteBuilderPanelProps) {
  const [search, setSearch] = useState("");
  const [slotSearch, setSlotSearch] = useState<number | null>(null);

  const stats = useMemo(
    () => computeLegStats(waypoints, speedKnots, tripType, routeSegments),
    [waypoints, speedKnots, tripType, routeSegments],
  );

  const searchResults = useMemo(
    () => filterTripPlannerSites(sites, search, { tidalOnly: !showAllSites, limit: 10 }),
    [sites, search, showAllSites],
  );

  const removeWaypoint = (index: number) => {
    const next = waypoints.filter((_, i) => i !== index).map((w, i) => ({ ...w, order_index: i }));
    onWaypointsChange(next);
  };

  const addEmptySlot = () => {
    setSlotSearch(waypoints.length);
    setSearch("");
  };

  const assignSiteToSlot = (site: TripPlannerSite, slot: number) => {
    const next = [...waypoints];
    const wp = siteToWaypoint(site, slot);
    if (slot < next.length) {
      next[slot] = wp;
    } else {
      next.push(wp);
    }
    onWaypointsChange(next.map((w, i) => ({ ...w, order_index: i })));
    setSlotSearch(null);
    setSearch("");
  };

  const getLegInfo = (index: number) => {
    if (index === 0) return null;
    const seg = routeSegments?.[index - 1];
    if (seg) {
      return {
        legNm: seg.distanceNm,
        legMin: Math.round((seg.distanceNm / speedKnots) * 60),
      };
    }
    return null;
  };

  return (
    <div
      className="flex flex-col gap-4 bg-card p-4 pb-[calc(5rem+env(safe-area-inset-bottom)+var(--focus-group-bar-height,0px))] lg:pb-6"
      data-testid="route-builder-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#1A3A5C] dark:text-foreground">Your route</h2>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showAllSites}
            onChange={(e) => onShowAllSitesChange(e.target.checked)}
          />
          Show all sites
        </label>
      </div>

      <div className="space-y-3">
        {waypoints.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tap a site on the map or search below to add your launch point.
          </p>
        )}

        {waypoints.map((wp, index) => {
          const leg = getLegInfo(index);
          const site = sites.find((s) => s.id === wp.site_id);
          const noTidal = site && !site.is_tidal;

          return (
            <div
              key={`${wp.site_id ?? wp.name}-${index}`}
              className="rounded-lg border border-border bg-background p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{wp.name}</p>
                  {leg && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDistance(leg.legNm)} · {formatTravelTime(leg.legMin)} at {speedKnots}{" "}
                      kts
                    </p>
                  )}
                  {noTidal && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ⓘ No tidal data for this site — tide timing unavailable
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${wp.name}`}
                  onClick={() => removeWaypoint(index)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          );
        })}

        {(slotSearch !== null || waypoints.length === 0) && (
          <div className="space-y-2">
            <Input
              placeholder={waypoints.length === 0 ? "Search launch site…" : "Search destination…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="plan-site-search"
            />
            {searchResults.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
                {searchResults.map((site) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => assignSiteToSlot(site, slotSearch ?? waypoints.length)}
                    >
                      {site.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addEmptySlot}
        className="w-full sm:w-fit"
      >
        <Plus size={14} className="mr-1" />
        Add waypoint
      </Button>

      {waypoints.length >= 2 && routeLoading && (
        <div
          className="flex min-h-20 items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          role="status"
        >
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">Finding a scenic water route…</p>
            <p className="mt-1 text-xs opacity-80">Checking every leg against mapped waterways.</p>
          </div>
        </div>
      )}

      {waypoints.length >= 2 && route && !routeLoading && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          <div className="flex items-start gap-2">
            <Leaf className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Scenic water route</p>
              <p className="mt-1 text-sm leading-5">
                {formatDistance(stats.roundTripDistanceNm)}
                {tripType === "tidal_transit" ? " total" : " round trip"} · ~
                {formatTravelTime(stats.roundTripMinutes)} paddle time
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {route.scenicHighlights.slice(0, 3).map((highlight) => (
                  <span
                    key={highlight}
                    className="max-w-full rounded-full bg-white/70 px-2 py-1 text-[11px] leading-none dark:bg-black/20"
                  >
                    {highlight}
                  </span>
                ))}
              </div>
              {route.warnings.map((warning) => (
                <p
                  key={warning}
                  className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300"
                >
                  {warning}
                </p>
              ))}
              <p className="mt-2 break-words text-[10px] opacity-65">
                Water graph {route.dataVersion} · © OpenStreetMap contributors
              </p>
            </div>
          </div>
        </div>
      )}

      {waypoints.length >= 2 && routingError && !routeLoading && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold">No verified all-water route</p>
            <p className="mt-1 break-words text-xs leading-5">
              {routingError.legIndex != null ? `Leg ${routingError.legIndex + 1}: ` : ""}
              {routingError.message}
            </p>
            <p className="mt-1 text-xs leading-5 opacity-80">
              Remove or change the affected waypoint. No direct line will be used in its place.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-medium">Trip type</Label>
        <RadioGroup
          value={tripType}
          onValueChange={(v) => onTripTypeChange(v as TripType)}
          className="space-y-1"
        >
          {(Object.keys(TRIP_TYPE_LABELS) as TripType[]).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <RadioGroupItem value={key} id={`trip-type-${key}`} />
              <Label htmlFor={`trip-type-${key}`} className="cursor-pointer text-sm font-normal">
                {TRIP_TYPE_LABELS[key]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">Paddling speed</Label>
        <Select value={String(speedKnots)} onValueChange={(v) => onSpeedChange(Number(v))}>
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PADDLING_SPEED_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s} kts
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        disabled={!canFindWindows}
        onClick={onFindWindows}
        data-testid="find-windows-btn"
        className="w-full"
      >
        {routeLoading
          ? "Finding water route…"
          : skipTidalWindows
            ? "View trip plan →"
            : "Find best windows →"}
      </Button>

      {waypoints.length < 2 && (
        <p className="text-center text-xs text-muted-foreground">
          Add a destination to find tidal windows
        </p>
      )}
      {waypoints.length >= 2 && routingError && (
        <p className="text-center text-xs text-muted-foreground">
          A verified route is required before continuing.
        </p>
      )}
    </div>
  );
}
