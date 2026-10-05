import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Droplet, MapPin } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { classifyStage } from "@/components/site/riverStageUtils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rivers/$gaugeId")({
  head: () => ({
    meta: [
      { property: "og:title", content: "River conditions — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV river conditions for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "River conditions — WaterWatch DMV" },
      {
        name: "description",
        content:
          "Live river stage, flow and 7-day trend from USGS gauges across the DC Metro area.",
      },
    ],
  }),
  component: RiverDetailPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-red-700" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Gauge not found.</div>
  ),
});

type Gauge = {
  id: string;
  usgs_site_number: string;
  name: string;
};

type Reading = {
  recorded_at: string;
  stage_ft: number | null;
  flow_cfs: number | null;
  trend: "rising" | "falling" | "steady" | null;
};

type Thresholds = {
  too_low_ft: number | null;
  optimal_min_ft: number | null;
  optimal_max_ft: number | null;
  caution_max_ft: number | null;
  notes: string | null;
};

type LinkedSite = {
  id: string;
  slug: string;
  name: string;
  site_type: string;
  status: string | null;
  sampled_at: string | null;
};

const TREND_ARROW = {
  rising: "↑",
  falling: "↓",
  steady: "→",
} as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function statusClass(status: string | null): string {
  switch (status) {
    case "safe":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "caution":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "unsafe":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

function RiverDetailPage() {
  const { gaugeId } = Route.useParams();
  const router = useRouter();

  const [gauge, setGauge] = useState<Gauge | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [sites, setSites] = useState<LinkedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [metric, setMetric] = useState<"stage_ft" | "flow_cfs">("stage_ft");

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [gRes, tRes, rRes, sRes] = await Promise.all([
        sb
          .from("river_gauges")
          .select("id, usgs_site_number, name")
          .eq("id", gaugeId)
          .maybeSingle(),
        sb
          .from("stage_thresholds")
          .select("too_low_ft, optimal_min_ft, optimal_max_ft, caution_max_ft, notes")
          .eq("station_id", gaugeId)
          .maybeSingle(),
        sb
          .from("gauge_readings")
          .select("recorded_at, stage_ft, flow_cfs, trend")
          .eq("station_id", gaugeId)
          .gte("recorded_at", cutoff)
          .order("recorded_at", { ascending: false }),
        sb
          .from("sites")
          .select("id, slug, name, site_type")
          .eq("nearest_gauge_id", gaugeId)
          .eq("is_active", true),
      ]);
      if (!active) return;
      if (!gRes.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setGauge(gRes.data as Gauge);
      setThresholds((tRes.data as Thresholds | null) ?? null);
      setReadings((rRes.data ?? []) as Reading[]);

      // Fetch latest reading per linked site
      const linkedSites = (sRes.data ?? []) as Array<{
        id: string;
        slug: string;
        name: string;
        site_type: string;
      }>;
      const enriched: LinkedSite[] = await Promise.all(
        linkedSites.map(async (s) => {
          const { data: lr } = await sb
            .from("readings")
            .select("status, sampled_at")
            .eq("site_id", s.id)
            .order("sampled_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return {
            ...s,
            status: (lr?.status as string | null) ?? null,
            sampled_at: (lr?.sampled_at as string | null) ?? null,
          };
        }),
      );
      if (!active) return;
      setSites(enriched);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [gaugeId]);

  const current = readings[0] ?? null;
  const stage = current?.stage_ft ?? null;
  const badge = stage != null ? classifyStage(stage, thresholds) : null;

  const chartData = useMemo(
    () =>
      readings
        .slice()
        .reverse()
        .filter((r) => r[metric] != null)
        .map((r) => ({
          t: r.recorded_at,
          v: r[metric] as number,
        })),
    [readings, metric],
  );

  const last20 = readings.slice(0, 20);

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <button
          onClick={() => router.history.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-teal-700 hover:underline dark:text-teal-400"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm text-muted-foreground">River gauge not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        {/* HEADER */}
        <button
          onClick={() => router.history.back()}
          aria-label="Go back"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          <ArrowLeft size={16} aria-hidden /> Back
        </button>

        <header className="space-y-2 border-b border-border pb-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <Droplet size={22} className="text-teal-600 dark:text-teal-400" aria-hidden />
                {gauge?.name ?? (loading ? "Loading…" : "River")}
              </h1>
              {gauge && (
                <p className="mt-1 text-sm text-muted-foreground">
                  USGS Gauge · {gauge.usgs_site_number}
                </p>
              )}
            </div>
            {badge && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            )}
          </div>

          {current && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2">
              <span className="text-4xl font-bold tabular-nums">
                {stage != null ? stage.toFixed(2) : "—"}
              </span>
              <span className="text-base text-muted-foreground">ft</span>
              {current.trend && (
                <span className="text-xl font-semibold text-teal-700 dark:text-teal-400">
                  {TREND_ARROW[current.trend]}
                </span>
              )}
              {current.flow_cfs != null && (
                <span className="text-sm text-muted-foreground">
                  · {current.flow_cfs.toLocaleString()} ft³/s
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                Updated {relativeTime(current.recorded_at)}
              </span>
            </div>
          )}
        </header>

        {/* CHART */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">7-day trend</h2>
            <div className="inline-flex rounded-md border border-border p-0.5 dark:border-gray-700">
              <button
                onClick={() => setMetric("stage_ft")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  metric === "stage_ft"
                    ? "bg-teal-600 text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Stage (ft)
              </button>
              <button
                onClick={() => setMetric("flow_cfs")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  metric === "flow_cfs"
                    ? "bg-teal-600 text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Flow (ft³/s)
              </button>
            </div>
          </div>

          <div className="h-64 w-full rounded-lg border border-border bg-card p-3 dark:border-gray-700 dark:bg-gray-800">
            {chartData.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    minTickGap={48}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={40}
                    label={{
                      value: metric === "stage_ft" ? "ft" : "ft³/s",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 11 },
                    }}
                  />
                  <RTooltip
                    formatter={(v: number) => [
                      metric === "stage_ft" ? `${v.toFixed(2)} ft` : `${v.toLocaleString()} ft³/s`,
                      metric === "stage_ft" ? "Stage" : "Flow",
                    ]}
                    labelFormatter={(v) =>
                      new Date(v as string).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
                  />
                  {metric === "stage_ft" && thresholds && (
                    <>
                      {thresholds.too_low_ft != null && thresholds.too_low_ft > 0 && (
                        <ReferenceLine
                          y={thresholds.too_low_ft}
                          stroke="#2563eb"
                          strokeDasharray="4 4"
                          label={{
                            value: "Too low",
                            fontSize: 10,
                            fill: "#2563eb",
                            position: "insideBottomLeft",
                          }}
                        />
                      )}
                      {thresholds.optimal_max_ft != null && (
                        <ReferenceLine
                          y={thresholds.optimal_max_ft}
                          stroke="#d97706"
                          strokeDasharray="4 4"
                          label={{
                            value: "Caution",
                            fontSize: 10,
                            fill: "#d97706",
                            position: "insideTopLeft",
                          }}
                        />
                      )}
                      {thresholds.caution_max_ft != null && (
                        <ReferenceLine
                          y={thresholds.caution_max_ft}
                          stroke="#dc2626"
                          strokeDasharray="4 4"
                          label={{
                            value: "Flood",
                            fontSize: 10,
                            fill: "#dc2626",
                            position: "insideTopLeft",
                          }}
                        />
                      )}
                    </>
                  )}
                  <Line type="monotone" dataKey="v" stroke="#0d9488" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {loading ? "Loading chart…" : "No data available"}
              </p>
            )}
          </div>
        </section>

        {/* READINGS TABLE */}
        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold">Recent readings</h2>
          <div className="max-h-80 overflow-auto rounded-lg border border-border dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date/Time</th>
                  <th className="px-3 py-2 text-right font-medium">Stage (ft)</th>
                  <th className="px-3 py-2 text-right font-medium">Flow (ft³/s)</th>
                  <th className="px-3 py-2 text-center font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {last20.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                      {loading ? "Loading…" : "No readings"}
                    </td>
                  </tr>
                ) : (
                  last20.map((r) => (
                    <tr key={r.recorded_at} className="border-t border-border dark:border-gray-700">
                      <td className="px-3 py-2 tabular-nums">
                        {new Date(r.recorded_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.stage_ft != null ? r.stage_ft.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.flow_cfs != null ? r.flow_cfs.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-center text-teal-700 dark:text-teal-400">
                        {r.trend ? TREND_ARROW[r.trend] : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* LINKED SITES */}
        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold">Water access sites on this gauge</h2>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? "Loading…" : "No linked sites."}
            </p>
          ) : (
            <ul className="space-y-2">
              {sites.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/sites/$slug"
                    params={{ slug: s.slug }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <MapPin
                        size={16}
                        className="shrink-0 text-teal-600 dark:text-teal-400"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="block text-xs capitalize text-muted-foreground">
                          {s.site_type.replace(/_/g, " ")}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                        statusClass(s.status),
                      )}
                    >
                      {s.status ?? "no data"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* FOOTER */}
        <footer className="mt-8 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground dark:border-gray-700">
          {gauge && (
            <p>
              Data from USGS Instantaneous Values · Site{" "}
              <a
                href={`https://waterdata.usgs.gov/monitoring-location/${gauge.usgs_site_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 underline underline-offset-2 hover:text-teal-800 dark:text-teal-400"
              >
                {gauge.usgs_site_number}
              </a>
            </p>
          )}
          <p>
            River conditions can change rapidly. Always assess conditions on site before entering
            the water.
          </p>
        </footer>
      </div>
    </div>
  );
}
