import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Anchor, ArrowDown, ArrowUp, MapPin } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWaterStatus, isStaleReading } from "@/lib/waterQualityEngine";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/tides")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Tides & Trip Planning — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV tides & trip planning for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Tides & Trip Planning — WaterWatch DMV" },
      {
        name: "description",
        content:
          "Next high and low tides for the Washington DC tidal Potomac and Anacostia, plus navigability for water access sites.",
      },
    ],
  }),
  component: TidesPage,
});

type Prediction = {
  predicted_at: string;
  type: string | null;
  height_ft: number | null;
};

type TidalSite = {
  id: string;
  name: string;
  slug: string;
  site_type: string;
  water_body: string | null;
  water_body_type: string;
  min_navigable_ft: number | null;
};

const STATION = "8594900";
const REFRESH_MS = 5 * 60 * 1000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatHour(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric" }).replace(/\s/g, " ");
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  )
    return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function deriveTidalState(
  upcoming: Prediction[],
  previous: Prediction | null,
): "Flooding" | "Ebbing" | "Near High Slack" | "Near Low Slack" | "Unknown" {
  const now = Date.now();
  const next = upcoming[0];
  if (!next) return "Unknown";
  const nextTime = new Date(next.predicted_at).getTime();
  const minsToNext = Math.abs(nextTime - now) / 60000;
  if (minsToNext <= 30) {
    return next.type === "H" ? "Near High Slack" : "Near Low Slack";
  }
  if (previous) {
    const prevMins = Math.abs(now - new Date(previous.predicted_at).getTime()) / 60000;
    if (prevMins <= 30) {
      return previous.type === "H" ? "Near High Slack" : "Near Low Slack";
    }
  }
  // Between previous and next
  if (next.type === "H") return "Flooding";
  if (next.type === "L") return "Ebbing";
  return "Unknown";
}

function siteTypeIcon() {
  return <MapPin className="h-4 w-4 text-teal-600 dark:text-teal-400" />;
}

function TidesPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [windowPredictions, setWindowPredictions] = useState<Prediction[]>([]);
  const [futurePredictions, setFuturePredictions] = useState<Prediction[]>([]);
  const [previousTide, setPreviousTide] = useState<Prediction | null>(null);
  const [sites, setSites] = useState<TidalSite[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestReadings, setLatestReadings] = useState<
    Map<string, { e_coli_mpn: number | null; enterococci_cce: number | null; sampled_at: string }>
  >(new Map());

  const loadData = async () => {
    try {
      const nowIso = new Date().toISOString();
      const windowStart = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const windowEnd = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
      const [upcoming, prev, windowRes, sitesRes] = await Promise.all([
        supabase
          .from("tidal_predictions")
          .select("predicted_at, type, height_ft")
          .gt("predicted_at", nowIso)
          .order("predicted_at", { ascending: true })
          .limit(4),
        supabase
          .from("tidal_predictions")
          .select("predicted_at, type, height_ft")
          .lte("predicted_at", nowIso)
          .order("predicted_at", { ascending: false })
          .limit(1),
        supabase
          .from("tidal_predictions")
          .select("predicted_at, type, height_ft")
          .gte("predicted_at", windowStart)
          .lte("predicted_at", windowEnd)
          .order("predicted_at", { ascending: true }),
        supabase
          .from("sites")
          .select("id, name, slug, site_type, water_body, water_body_type, min_navigable_ft")
          .eq("is_tidal", true)
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);
      if (upcoming.error) throw upcoming.error;
      if (windowRes.error) throw windowRes.error;
      if (sitesRes.error) throw sitesRes.error;
      setPredictions(upcoming.data ?? []);
      setWindowPredictions(windowRes.data ?? []);
      setFuturePredictions(upcoming.data ?? []);
      const prevRow = prev.data?.[0] ?? null;
      setPreviousTide(prevRow);
      const loadedSites = (sitesRes.data ?? []) as TidalSite[];
      setSites(loadedSites);

      if (loadedSites.length > 0) {
        const siteIds = loadedSites.map((s) => s.id);
        const { data: readingsData } = await supabase
          .from("readings")
          .select("site_id, e_coli_mpn, enterococci_cce, sampled_at")
          .in("site_id", siteIds)
          .order("sampled_at", { ascending: false });
        const map = new Map<
          string,
          { e_coli_mpn: number | null; enterococci_cce: number | null; sampled_at: string }
        >();
        for (const r of readingsData ?? []) {
          if (!map.has(r.site_id)) {
            map.set(r.site_id, r);
          }
        }
        setLatestReadings(map);
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tidal data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const dataInt = setInterval(() => void loadData(), REFRESH_MS);
    const clockInt = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearInterval(dataInt);
      clearInterval(clockInt);
    };
  }, []);

  const tidalState = useMemo(
    () => deriveTidalState(predictions, previousTide),
    [predictions, previousTide],
  );

  // Cosine interpolation between bracketing H/L predictions — a standard
  // approximation for the tidal sinusoid between extrema.
  const interpolateHeight = (t: number, sorted: Prediction[]): number | null => {
    if (sorted.length === 0) return null;
    let prev: Prediction | null = null;
    let next: Prediction | null = null;
    for (const p of sorted) {
      const pt = new Date(p.predicted_at).getTime();
      if (pt <= t) prev = p;
      else {
        next = p;
        break;
      }
    }
    if (prev && next && prev.height_ft != null && next.height_ft != null) {
      const t0 = new Date(prev.predicted_at).getTime();
      const t1 = new Date(next.predicted_at).getTime();
      const f = (t - t0) / (t1 - t0);
      const h0 = prev.height_ft;
      const h1 = next.height_ft;
      return (h0 + h1) / 2 + ((h0 - h1) / 2) * Math.cos(Math.PI * f);
    }
    return prev?.height_ft ?? next?.height_ft ?? null;
  };

  const chartData = useMemo(() => {
    if (windowPredictions.length === 0)
      return [] as { t: number; height: number; marker?: "H" | "L" }[];
    const start = Date.now();
    const end = start + 24 * 3600 * 1000;
    const step = 15 * 60 * 1000;
    const points: { t: number; height: number; marker?: "H" | "L" }[] = [];
    for (let t = start; t <= end; t += step) {
      const h = interpolateHeight(t, windowPredictions);
      if (h != null) points.push({ t, height: Number(h.toFixed(3)) });
    }
    // Add H/L extrema markers within range
    for (const p of windowPredictions) {
      const pt = new Date(p.predicted_at).getTime();
      if (pt >= start && pt <= end && p.height_ft != null && (p.type === "H" || p.type === "L")) {
        points.push({ t: pt, height: Number(p.height_ft.toFixed(3)), marker: p.type });
      }
    }
    points.sort((a, b) => a.t - b.t);
    return points;
  }, [windowPredictions]);

  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 5];
    const vals = chartData.map((d) => d.height);
    return [Math.min(...vals) - 0.5, Math.max(...vals) + 0.5];
  }, [chartData]);

  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const start = now.getTime();
    const startHour = new Date(start);
    startHour.setMinutes(0, 0, 0);
    let t = startHour.getTime();
    while (t < start) t += 3600 * 1000;
    for (let i = 0; i < 13; i += 1) {
      ticks.push(t + i * 2 * 3600 * 1000);
    }
    return ticks;
  }, [now]);

  const currentHeight = useMemo(() => {
    if (windowPredictions.length === 0) return previousTide?.height_ft ?? null;
    return interpolateHeight(now.getTime(), windowPredictions);
  }, [windowPredictions, previousTide, now]);

  const stateBadgeClass =
    tidalState === "Flooding"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
      : tidalState === "Ebbing"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200";

  const groupedSites = useMemo(() => {
    const groups = new Map<string, TidalSite[]>();
    for (const s of sites) {
      const key = s.water_body ?? "Other";
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return Array.from(groups.entries());
  }, [sites]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl px-4 pt-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
            Tides &amp; Trip Planning
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Washington DC · NOAA Station {STATION}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            {now.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </header>

        {error && (
          <Card className="mb-4 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
            <CardContent className="p-4 text-sm text-red-700 dark:text-red-300">
              {error}
            </CardContent>
          </Card>
        )}

        <Card className="mb-6 border-teal-200 dark:border-teal-900">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Next tides</CardTitle>
            <Badge className={stateBadgeClass} variant="outline">
              {tidalState}
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {loading && predictions.length === 0 ? (
              <p className="text-sm text-gray-500">Loading tides…</p>
            ) : predictions.length === 0 ? (
              <p className="text-sm text-gray-500">No upcoming tide predictions.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {predictions.map((p) => {
                  const isHigh = p.type === "H";
                  return (
                    <li key={p.predicted_at} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            isHigh
                              ? "flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              : "flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          }
                          aria-label={isHigh ? "High tide" : "Low tide"}
                        >
                          {isHigh ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )}
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {isHigh ? "High" : "Low"} · {formatTime(p.predicted_at)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDateLabel(p.predicted_at)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {p.height_ft != null ? `${p.height_ft.toFixed(2)} ft` : "—"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Today&apos;s tidal curve · NOAA station {STATION}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {chartData.length === 0 ? (
              <p className="text-sm text-gray-500">No tidal data available.</p>
            ) : (
              <div className="h-[200px] w-full md:h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 16, right: 12, left: -8, bottom: 4 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-gray-200 dark:stroke-gray-800"
                    />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={[xTicks[0], xTicks[xTicks.length - 1]]}
                      ticks={xTicks}
                      tickFormatter={(v: number) => formatHour(new Date(v))}
                      tick={{ fontSize: 11 }}
                      stroke="currentColor"
                      className="text-gray-500"
                    />
                    <YAxis
                      domain={yDomain}
                      tickFormatter={(v: number) => `${v.toFixed(1)}`}
                      tick={{ fontSize: 11 }}
                      width={36}
                      stroke="currentColor"
                      className="text-gray-500"
                      label={{
                        value: "ft (MLLW)",
                        angle: -90,
                        position: "insideLeft",
                        fontSize: 11,
                        offset: 16,
                      }}
                    />
                    <Tooltip
                      labelFormatter={(v: number) =>
                        new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      }
                      formatter={(v: number) => [`${v.toFixed(2)} ft`, "Height"]}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <ReferenceLine
                      y={1.0}
                      stroke="#d97706"
                      strokeDasharray="4 4"
                      label={{
                        value: "Min navigable (Potomac)",
                        position: "insideTopRight",
                        fontSize: 10,
                        fill: "#d97706",
                      }}
                    />
                    <ReferenceLine
                      y={0.5}
                      stroke="#2563eb"
                      strokeDasharray="4 4"
                      label={{
                        value: "Min navigable (Anacostia)",
                        position: "insideBottomRight",
                        fontSize: 10,
                        fill: "#2563eb",
                      }}
                    />
                    <ReferenceLine
                      x={now.getTime()}
                      stroke="#0D9488"
                      strokeDasharray="4 4"
                      label={{ value: "Now", position: "top", fontSize: 11, fill: "#0D9488" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="height"
                      stroke="#0D9488"
                      strokeWidth={2}
                      dot={(props: {
                        cx?: number;
                        cy?: number;
                        payload?: { marker?: "H" | "L" };
                      }) => {
                        const { cx, cy, payload } = props;
                        if (!payload?.marker || cx == null || cy == null) {
                          return <g />;
                        }
                        const isH = payload.marker === "H";
                        return (
                          <g>
                            <circle cx={cx} cy={cy} r={3.5} fill="#0D9488" />
                            <text
                              x={cx}
                              y={isH ? cy - 8 : cy + 14}
                              textAnchor="middle"
                              fontSize={11}
                              fontWeight={600}
                              fill={isH ? "#1d4ed8" : "#b45309"}
                            >
                              {payload.marker}
                            </text>
                          </g>
                        );
                      }}
                      activeDot={{ r: 5, fill: "#0D9488" }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Water access sites
          </h2>
          {loading && sites.length === 0 ? (
            <p className="text-sm text-gray-500">Loading sites…</p>
          ) : sites.length === 0 ? (
            <p className="text-sm text-gray-500">No tidal sites found.</p>
          ) : (
            <div className="space-y-6">
              {groupedSites.map(([waterBody, group]) => (
                <div key={waterBody}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {waterBody}
                  </h3>
                  <div className="space-y-2">
                    {group.map((s) => {
                      const min = s.min_navigable_ft != null ? Number(s.min_navigable_ft) : null;
                      const navigable =
                        min == null || currentHeight == null ? null : currentHeight >= min;
                      const nextLow = futurePredictions.find((p) => p.type === "L");
                      const nextNavigable =
                        min != null
                          ? futurePredictions.find((p) => p.height_ft != null && p.height_ft > min)
                          : null;
                      return (
                        <Link
                          key={s.id}
                          to="/sites/$slug"
                          params={{ slug: s.slug }}
                          className="block"
                        >
                          <Card className="transition-colors hover:border-teal-300 dark:hover:border-teal-700">
                            <CardContent className="flex items-start justify-between gap-3 p-4">
                              <div className="flex items-start gap-3">
                                {siteTypeIcon()}
                                <div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                    {s.name}
                                  </div>
                                  {nextLow && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      Next low tide: {formatTime(nextLow.predicted_at)}
                                      {nextLow.height_ft != null
                                        ? ` · ${nextLow.height_ft.toFixed(2)} ft`
                                        : ""}
                                    </div>
                                  )}
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {s.site_type.replace(/_/g, " ")}
                                    {min != null && ` · min ${min} ft`}
                                  </div>
                                  {navigable === false && nextNavigable && (
                                    <div className="mt-1 text-xs text-red-700 dark:text-red-300">
                                      Next navigable after {formatTime(nextNavigable.predicted_at)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {(() => {
                                const reading = latestReadings.get(s.id);
                                const wq = reading
                                  ? getWaterStatus(
                                      reading.e_coli_mpn,
                                      reading.enterococci_cce,
                                      s.water_body_type as "freshwater" | "tidal_brackish",
                                      reading.sampled_at,
                                    )
                                  : null;
                                const stale = reading ? isStaleReading(reading.sampled_at) : false;
                                const isStalePass = stale && wq?.status === "pass";
                                if (navigable === false) {
                                  return (
                                    <Badge
                                      variant="outline"
                                      className="border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    >
                                      Below minimum depth
                                    </Badge>
                                  );
                                }
                                if (wq?.status === "pass") {
                                  return (
                                    <Badge
                                      variant="outline"
                                      className={
                                        isStalePass
                                          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                          : "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300"
                                      }
                                    >
                                      {isStalePass ? "Data may be outdated" : "Pass"}
                                    </Badge>
                                  );
                                }
                                if (wq?.status === "caution") {
                                  return (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                    >
                                      Caution
                                    </Badge>
                                  );
                                }
                                if (wq?.status === "unsafe") {
                                  return (
                                    <Badge
                                      variant="outline"
                                      className="border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                                    >
                                      Unsafe
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </CardContent>
                          </Card>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              {currentHeight != null && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Current approx. tide height: {currentHeight.toFixed(2)} ft (NOAA station {STATION}
                  )
                </p>
              )}
            </div>
          )}
        </section>

        <footer className="mt-8 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
          <Anchor className="h-3 w-3" />
          Predictions via NOAA CO-OPS. Always verify local conditions before launching.
        </footer>
      </div>
    </div>
  );
}
