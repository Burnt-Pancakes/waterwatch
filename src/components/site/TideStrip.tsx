import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Tides } from "@/components/icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { CollapsibleCard } from "./CollapsibleCard";

type CurrentTide = {
  height_ft: number;
  direction: string;
  next_event_type: string;
  next_event_time: string;
  minutes_to_slack: number;
  prev_height_ft: number;
  next_height_ft: number;
};

type TodaysTide = {
  event_order: number;
  type: string;
  predicted_at: string;
  height_ft: number;
};

type Props = { siteId: string };

/**
 * Renders Now Strip + Today's Tides strip for tidal sites.
 * Renders nothing if the site is non-tidal or has no NOAA station assigned.
 */
export function TideStrip({ siteId }: Props) {
  const [stationId, setStationId] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentTide | null>(null);
  const [today, setToday] = useState<TodaysTide[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    let active = true;
    setLoaded(false);
    setEligible(false);
    setCurrent(null);
    setToday([]);
    (async () => {
      const sb = supabase as unknown as SupabaseClient;
      const { data: site } = await sb
        .from("sites")
        .select("is_tidal, tidal_gauge_station_id")
        .eq("id", siteId)
        .maybeSingle();
      if (!active) return;
      const s = site as { is_tidal: boolean | null; tidal_gauge_station_id: string | null } | null;
      if (!s?.is_tidal || !s.tidal_gauge_station_id) {
        setLoaded(true);
        return;
      }
      setEligible(true);
      setStationId(s.tidal_gauge_station_id);

      const [curRes, todayRes] = await Promise.all([
        sb.rpc("get_current_tide", {
          p_station_id: s.tidal_gauge_station_id,
          p_at: new Date().toISOString(),
        }),
        sb
          .from("v_todays_tides")
          .select("*")
          .eq("noaa_station_id", s.tidal_gauge_station_id)
          .order("event_order"),
      ]);
      if (!active) return;
      const curRows = (curRes.data ?? []) as CurrentTide[];
      setCurrent(curRows[0] ?? null);
      setToday((todayRes.data ?? []) as TodaysTide[]);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [siteId]);

  if (loaded && !eligible) return null;

  if (!loaded) {
    return (
      <CollapsibleCard
        title="Tides"
        icon={<Tides size={16} aria-hidden className="shrink-0 text-teal-600" />}
        loading
      >
        <div />
      </CollapsibleCard>
    );
  }

  if (!current && today.length === 0) {
    return (
      <CollapsibleCard
        testId="tide-strip-unavailable"
        title="Tides"
        icon={<Tides size={16} aria-hidden className="shrink-0 text-teal-600" />}
      >
        <p className="text-sm text-muted-foreground">Tidal data unavailable for this station.</p>
      </CollapsibleCard>
    );
  }

  const now = Date.now();
  const nextIdx = today.findIndex((t) => Date.parse(t.predicted_at) >= now);

  return (
    <CollapsibleCard
      testId="tide-strip"
      title="Tides"
      icon={<Tides size={16} aria-hidden className="shrink-0 text-teal-600" />}
      summary={
        current ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
            {current.height_ft.toFixed(1)} ft
          </span>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {current && <NowStrip current={current} />}
        {current && <SessionWindow current={current} />}
        {today.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Today's Tides
            </p>
            <div className="grid grid-cols-4 gap-2 rounded-md border border-border bg-card px-2 py-2">
              {today.map((t, i) => (
                <TideCell
                  key={`${t.event_order}-${t.predicted_at}`}
                  tide={t}
                  isPast={Date.parse(t.predicted_at) < now}
                  isNext={i === nextIdx}
                />
              ))}
            </div>
            {stationId && (
              <p className="text-[10px] text-muted-foreground">
                Tidal data: NOAA CO-OPS · {stationId}
              </p>
            )}
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

function SessionWindow({ current }: { current: CurrentTide }) {
  const mts = current.minutes_to_slack;

  let tier: "good" | "fair" | "strong";
  if (mts <= 45) tier = "good";
  else if (mts <= 120) tier = "fair";
  else tier = "strong";

  const tierConfig = {
    good: {
      label: "Good window",
      pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      bg: "bg-emerald-50/60 dark:bg-emerald-950/20",
    },
    fair: {
      label: "Fair window",
      pill: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
      bg: "bg-amber-50/60 dark:bg-amber-950/20",
    },
    strong: {
      label: "Strong current",
      pill: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
      bg: "bg-red-50/60 dark:bg-red-950/20",
    },
  }[tier];

  const nextEvent = new Date(current.next_event_time);
  const windowStart = new Date(nextEvent.getTime() - 45 * 60 * 1000);
  const windowEnd = new Date(nextEvent.getTime() + 45 * 60 * 1000);

  const format12h = (d: Date) => {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, "0")}${ampm}`;
  };

  const eventLabel = current.next_event_type === "H" ? "high" : "low";

  return (
    <div
      data-testid="session-window"
      className={cn("space-y-1 rounded-md border border-border px-3 py-2.5", tierConfig.bg)}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
            tierConfig.pill,
          )}
        >
          {tierConfig.label}
        </span>
        {tier !== "strong" && (
          <span className="font-medium text-foreground">
            {format12h(windowStart)} – {format12h(windowEnd)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {tier === "strong" ? (
          <>Next slack in {formatDuration(mts)} · consider waiting</>
        ) : (
          <>
            Slack at {format12h(nextEvent)} · {Number(current.next_height_ft).toFixed(1)}ft{" "}
            {eventLabel}
          </>
        )}
      </p>
    </div>
  );
}

function NowStrip({ current }: { current: CurrentTide }) {
  const flooding = current.direction === "Flooding";
  const Arrow = flooding ? ArrowUpRight : ArrowDownRight;
  const dirColor = flooding
    ? "text-blue-600 dark:text-blue-400"
    : "text-amber-600 dark:text-amber-400";
  const nearSlack = current.minutes_to_slack < 20;

  return (
    <div
      data-testid="now-strip"
      className="flex items-stretch divide-x divide-border rounded-md border border-border bg-card text-sm"
    >
      <div
        className={cn(
          "flex flex-1 items-center justify-center gap-1 px-2 py-2 font-medium",
          dirColor,
        )}
      >
        <Arrow size={16} aria-hidden />
        <span>{current.direction}</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-2 py-2 text-muted-foreground">
        {Number(current.height_ft).toFixed(1)} ft
      </div>
      <div className="flex flex-1 items-center justify-center px-2 py-2">
        {nearSlack ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Near slack
          </span>
        ) : (
          <span className="text-foreground/80">{formatSlack(current.minutes_to_slack)}</span>
        )}
      </div>
    </div>
  );
}

function TideCell({
  tide,
  isPast,
  isNext,
}: {
  tide: TodaysTide;
  isPast: boolean;
  isNext: boolean;
}) {
  const high = tide.type === "H";
  const labelColor = high ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground";
  return (
    <div
      data-testid="tide-cell"
      data-past={isPast}
      data-next={isNext}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center text-xs",
        isPast && "opacity-45",
        isNext && "border-b-2 border-primary",
      )}
    >
      <span className={cn("font-medium", labelColor)}>{high ? "High" : "Low"}</span>
      <span className={cn("text-foreground", isNext && "font-bold")}>
        {formatTime(tide.predicted_at)}
      </span>
      <span className="text-muted-foreground">{formatHeight(Number(tide.height_ft))}</span>
    </div>
  );
}

function formatSlack(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `Slack in ${h}h ${rem}m`;
  return `Slack in ${rem}m`;
}

function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}h ${rem}m`;
  return `${rem}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")}${ampm}`;
}

function formatHeight(v: number): string {
  return `${v.toFixed(1)}ft`;
}
