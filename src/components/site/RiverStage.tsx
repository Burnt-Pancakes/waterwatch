import { useEffect, useState } from "react";
import { Droplet } from "@/components/icons";
import { Line, LineChart, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { CollapsibleCard } from "./CollapsibleCard";
import {
  classifyStage,
  relativeTime,
  TREND_ARROW,
  type GaugeReading,
  type Thresholds,
} from "./riverStageUtils";

type GaugeResponse = {
  gauge: { id: string; usgs_site_number: string; name: string };
  thresholds: Thresholds | null;
  current: GaugeReading | null;
  history: GaugeReading[];
};

type Props = { siteId: string };

/**
 * River conditions card — current stage, trend, flow and 24h sparkline.
 * Renders nothing when the site has no linked gauge.
 */
export function RiverStage({ siteId }: Props) {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<GaugeResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [hasGauge, setHasGauge] = useState<boolean | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!siteId) return;
    let active = true;
    setData(null);
    setUnavailable(false);
    setHasGauge(null);
    (async () => {
      try {
        // 1) Find linked gauge for this site
        const { data: site } = await supabase
          .from("sites")
          .select("nearest_gauge_id")
          .eq("id", siteId)
          .maybeSingle();
        const gaugeId = (site as { nearest_gauge_id: string | null } | null)?.nearest_gauge_id;
        if (!active) return;
        if (!gaugeId) {
          setHasGauge(false);
          return;
        }
        setHasGauge(true);

        // 2) Gauge metadata + thresholds + 24h history in parallel
        const sb = supabase as unknown as SupabaseClient;
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [gaugeRes, threshRes, readingsRes] = await Promise.all([
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
        ]);
        if (!active) return;
        if (!gaugeRes.data) {
          setHasGauge(false);
          return;
        }
        const history = (readingsRes.data ?? []) as GaugeReading[];
        const current = history[0] ?? null;
        setData({
          gauge: gaugeRes.data,
          thresholds: threshRes.data ?? null,
          current,
          history,
        });
        if (!current || current.stage_ft == null) setUnavailable(true);
      } catch {
        if (active) setHasGauge(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [siteId]);

  if (!mounted || hasGauge === false) return null;

  if (!data) {
    return (
      <CollapsibleCard
        testId="river-stage"
        title="River conditions"
        icon={<Droplet size={16} aria-hidden className="text-teal-600 dark:text-teal-400" />}
        loading
      >
        <div />
      </CollapsibleCard>
    );
  }

  const { gauge, thresholds, current, history } = data;

  const sparkData = history
    .slice()
    .reverse()
    .filter((r) => r.stage_ft != null)
    .map((r) => ({ t: r.recorded_at, v: r.stage_ft as number }));

  const stage = current?.stage_ft ?? null;
  const flow = current?.flow_cfs ?? null;
  const trend = current?.trend ?? null;
  const badge = stage != null ? classifyStage(stage, thresholds) : null;

  return (
    <CollapsibleCard
      testId="river-stage"
      title="River conditions"
      icon={<Droplet size={16} aria-hidden className="shrink-0 text-teal-600 dark:text-teal-400" />}
      summary={
        badge ? (
          <span
            data-testid="stage-badge"
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        ) : undefined
      }
    >
      {unavailable ? (
        <p className="text-xs text-muted-foreground">River data unavailable</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span
              data-testid="stage-value"
              className="text-2xl font-bold tabular-nums text-foreground dark:text-white"
            >
              {stage != null ? stage.toFixed(2) : "—"}
            </span>
            <span className="text-sm text-muted-foreground">ft</span>
            {trend && (
              <span
                data-testid="stage-trend"
                aria-label={TREND_ARROW[trend].aria}
                className="text-lg font-semibold text-teal-700 dark:text-teal-400"
              >
                {TREND_ARROW[trend].arrow}
              </span>
            )}
            {flow != null && (
              <span data-testid="stage-flow" className="ml-auto text-xs text-muted-foreground">
                {flow.toLocaleString()} ft³/s
              </span>
            )}
          </div>

          {sparkData.length >= 2 && (
            <div data-testid="stage-sparkline" className="h-14 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparkData}>
                  <RTooltip
                    formatter={(v: number) => [`${v.toFixed(2)} ft`, "Stage"]}
                    labelFormatter={(_, p) =>
                      p?.[0]?.payload?.t
                        ? new Date(p[0].payload.t).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="#0d9488"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {!unavailable && (
        <div className="text-right">
          <a
            href={`/rivers/${gauge.id}`}
            className="text-xs text-teal-600 underline underline-offset-2 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            View river details →
          </a>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Via{" "}
        <a
          href={`https://waterdata.usgs.gov/monitoring-location/${gauge.usgs_site_number}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-teal-700 dark:hover:text-teal-400"
        >
          USGS
        </a>{" "}
        · {gauge.name}
        {current?.recorded_at && <> · updated {relativeTime(current.recorded_at)}</>}
      </p>
    </CollapsibleCard>
  );
}
