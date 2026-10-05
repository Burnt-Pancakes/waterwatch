import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Rivers, Search, X, MapPin } from "@/components/icons";
import { cn } from "@/lib/utils";
import { classifyStage, type Thresholds } from "@/components/site/riverStageUtils";

export const Route = createFileRoute("/rivers/")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Rivers — WaterWatch DMV" },
      { property: "og:description", content: "Browse USGS river gauges across the DMV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Rivers — WaterWatch DMV" },
      { name: "description", content: "Browse USGS river gauges across the DMV." },
    ],
  }),
  component: RiversIndex,
});

type Gauge = {
  id: string;
  name: string;
  usgs_site_number: string;
  state_code: string | null;
  county: string | null;
  lat: number;
  lng: number;
};

type LatestReading = { stage_ft: number | null };

const PILL_NO_DATA = "bg-muted text-muted-foreground";

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(mi: number): string {
  return mi < 1 ? `${mi.toFixed(1)} mi` : `${mi.toFixed(1)} mi`;
}

const PILL_BY_LABEL: Record<string, { label: string; className: string }> = {
  "Too low": {
    label: "Low",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  },
  Optimal: {
    label: "Optimal",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  Caution: {
    label: "Elevated",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  Flood: {
    label: "High",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  },
};

function RiversIndex() {
  const [gauges, setGauges] = useState<Gauge[] | null>(null);
  const [latest, setLatest] = useState<Record<string, LatestReading>>({});
  const [thresholds, setThresholds] = useState<Record<string, Thresholds>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "loading" | "granted" | "denied">("idle");
  const [addressInput, setAddressInput] = useState("");
  const [geocodeState, setGeocodeState] = useState<"idle" | "loading" | "notfound" | "error">(
    "idle",
  );
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("river_gauges")
      .select("id, name, usgs_site_number, state_code, county, lat, lng")
      .eq("is_tidal", false)
      .order("name")
      .then(({ data }) => setGauges((data as Gauge[]) ?? []));

    // Latest reading per gauge (last 24h is plenty given 15-min ingest cadence)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    void supabase
      .from("gauge_readings")
      .select("station_id, stage_ft, recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .then(({ data }) => {
        const map: Record<string, LatestReading> = {};
        for (const r of (data ?? []) as Array<{
          station_id: string;
          stage_ft: number | null;
        }>) {
          if (!map[r.station_id]) map[r.station_id] = { stage_ft: r.stage_ft };
        }
        setLatest(map);
      });

    void supabase
      .from("stage_thresholds")
      .select("station_id, too_low_ft, optimal_min_ft, optimal_max_ft, caution_max_ft, notes")
      .then(({ data }) => {
        const map: Record<string, Thresholds> = {};
        for (const t of (data ?? []) as Array<Thresholds & { station_id: string }>) {
          map[t.station_id] = {
            too_low_ft: t.too_low_ft != null ? Number(t.too_low_ft) : null,
            optimal_min_ft: t.optimal_min_ft != null ? Number(t.optimal_min_ft) : null,
            optimal_max_ft: t.optimal_max_ft != null ? Number(t.optimal_max_ft) : null,
            caution_max_ft: t.caution_max_ft != null ? Number(t.caution_max_ft) : null,
            notes: t.notes,
          };
        }
        setThresholds(map);
      });
  }, []);

  const filteredGauges = useMemo(() => {
    if (!gauges || !searchTerm.trim()) return gauges;
    const term = searchTerm.trim().toLowerCase();
    return gauges.filter((g) => g.name.toLowerCase().includes(term));
  }, [gauges, searchTerm]);

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState("granted");
        setPlaceLabel(null);
        setGeocodeState("idle");
      },
      () => setGeoState("denied"),
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  };

  const handleGeocode = async () => {
    const q = addressInput.trim();
    if (!q) return;
    setGeocodeState("loading");
    setGeoState("loading");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "WaterVoiceDMV/1.0 (water-voice-dmv.lovable.app)" },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
      }>;
      if (!data || data.length === 0) {
        setGeocodeState("notfound");
        setGeoState((s) => (s === "loading" ? "idle" : s));
        return;
      }
      const r = data[0];
      setUserLoc({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
      setPlaceLabel(r.display_name.split(",").slice(0, 2).join(",").trim());
      setGeoState("granted");
      setGeocodeState("idle");
    } catch {
      setGeocodeState("error");
      setGeoState((s) => (s === "loading" ? "idle" : s));
    }
  };

  const nearbyGauges = useMemo(() => {
    if (!gauges || !userLoc) return null;
    return gauges
      .map((g) => ({ gauge: g, distMi: haversineMi(userLoc.lat, userLoc.lng, g.lat, g.lng) }))
      .sort((a, b) => a.distMi - b.distMi)
      .slice(0, 3);
  }, [gauges, userLoc]);

  const showNearYou = !searchTerm.trim();
  const showGeoButton = geoState !== "denied";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <header className="mb-4 flex items-center gap-2">
        <Rivers className="text-teal-700 dark:text-teal-500" size={24} />
        <h1 className="text-2xl font-bold">Rivers</h1>
      </header>
      <p className="mb-4 text-sm text-muted-foreground">
        USGS streamflow gauges across the DMV. Tap a gauge for current stage, trend, and 7-day
        history.
      </p>

      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search rivers..."
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {showNearYou && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Near You</h2>
          {placeLabel && geoState === "granted" && (
            <p className="mb-2 text-xs text-muted-foreground">Near {placeLabel}</p>
          )}
          {geoState !== "granted" && geoState !== "loading" && (
            <Card className="mb-2 flex flex-col gap-3 p-3">
              {showGeoButton && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin size={16} className="text-muted-foreground" />
                      <span>See gauges near you</span>
                    </div>
                    <button
                      onClick={requestLocation}
                      className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      Use my location
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    or
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleGeocode();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="Enter address or zip code..."
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  Go
                </button>
              </form>
              {geocodeState === "notfound" && (
                <p className="text-xs text-muted-foreground">
                  Location not found — try a zip code or city name
                </p>
              )}
              {geocodeState === "error" && (
                <p className="text-xs text-muted-foreground">
                  Could not reach location service — try again
                </p>
              )}
            </Card>
          )}
          {geoState === "loading" && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="h-[68px] animate-pulse bg-muted/40 p-4" />
              ))}
            </div>
          )}
          {geoState === "granted" && nearbyGauges && (
            <div className="flex flex-col gap-2">
              {nearbyGauges.map(({ gauge: g, distMi }) => {
                const reading = latest[g.id];
                const stage = reading?.stage_ft != null ? Number(reading.stage_ft) : null;
                const badge = stage != null ? classifyStage(stage, thresholds[g.id] ?? null) : null;
                const pill = badge ? PILL_BY_LABEL[badge.label] : null;
                return (
                  <Link
                    key={g.id}
                    to="/rivers/$gaugeId"
                    params={{ gaugeId: g.id }}
                    className="block"
                  >
                    <Card className="p-4 transition-colors hover:bg-accent">
                      <div className="flex items-center gap-3">
                        <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                          <MapPin size={12} />
                          {formatDistance(distMi)}
                        </div>
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</div>
                        <div className="flex shrink-0 items-center gap-2">
                          {stage == null ? (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                PILL_NO_DATA,
                              )}
                            >
                              No data
                            </span>
                          ) : (
                            <>
                              {pill && (
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-xs font-medium",
                                    pill.className,
                                  )}
                                >
                                  {pill.label}
                                </span>
                              )}
                              <span className="text-sm tabular-nums text-foreground">
                                {stage.toFixed(1)} ft
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {gauges === null && <p className="text-sm text-muted-foreground">Loading gauges…</p>}
      {gauges?.length === 0 && (
        <p className="text-sm text-muted-foreground">No river gauges available.</p>
      )}

      {filteredGauges && filteredGauges.length === 0 && searchTerm.trim() && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No rivers found for &lsquo;{searchTerm.trim()}&rsquo;
        </p>
      )}

      <div className="flex flex-col gap-2">
        {filteredGauges?.map((g) => {
          const reading = latest[g.id];
          const stage = reading?.stage_ft != null ? Number(reading.stage_ft) : null;
          const badge = stage != null ? classifyStage(stage, thresholds[g.id] ?? null) : null;
          const pill = badge ? PILL_BY_LABEL[badge.label] : null;
          return (
            <Link key={g.id} to="/rivers/$gaugeId" params={{ gaugeId: g.id }} className="block">
              <Card className="p-4 transition-colors hover:bg-accent">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{g.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      USGS {g.usgs_site_number}
                      {g.state_code ? ` · ${g.state_code}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {stage == null ? (
                      <span
                        className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PILL_NO_DATA)}
                      >
                        No data
                      </span>
                    ) : (
                      <>
                        {pill && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              pill.className,
                            )}
                          >
                            {pill.label}
                          </span>
                        )}
                        <span className="text-sm tabular-nums text-foreground">
                          {stage.toFixed(1)} ft
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
