import { useEffect, useState } from "react";
import { AlertTriangle, CloudRain, Wind, Cloud } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { CollapsibleCard } from "./CollapsibleCard";

type WeatherReading = Tables<"weather_readings">;
type WeatherAlert = Tables<"weather_alerts">;

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export function WeatherCard() {
  const [readings, setReadings] = useState<WeatherReading[] | null>(null);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAlert, setExpandedAlert] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const nowIso = new Date().toISOString();
      const [r, a] = await Promise.all([
        supabase
          .from("weather_readings")
          .select("*")
          .order("observed_at", { ascending: false })
          .limit(6),
        supabase
          .from("weather_alerts")
          .select("*")
          .gt("expires_at", nowIso)
          .order("effective_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setReadings(r.data ?? []);
      setAlerts(a.data ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <CollapsibleCard
        title="Weather conditions"
        icon={<Cloud size={16} aria-hidden className="shrink-0 text-teal-600" />}
        loading
      >
        <div />
      </CollapsibleCard>
    );
  }

  const latest = readings && readings.length > 0 ? readings[0] : null;

  if (!latest) {
    return (
      <CollapsibleCard
        title="Weather conditions"
        icon={<Cloud size={16} aria-hidden className="shrink-0 text-teal-600" />}
      >
        <p className="text-xs text-muted-foreground">Weather data unavailable</p>
      </CollapsibleCard>
    );
  }

  const windSpeed = Number(latest.wind_speed_mph ?? 0);
  const windColor =
    windSpeed > 25 ? "text-red-600" : windSpeed > 15 ? "text-amber-600" : "text-foreground";
  const precip = latest.precip_probability_pct ?? 0;

  return (
    <CollapsibleCard
      title="Weather conditions"
      icon={<Cloud size={16} aria-hidden className="shrink-0 text-teal-600" />}
      summary={
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
          {windSpeed} mph · {precip}%
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Via NWS · Washington DC · updated {relativeTime(latest.fetched_at)}
        </p>

        {alerts.length > 0 && (
          <button
            type="button"
            onClick={() => setExpandedAlert((v) => !v)}
            className="flex w-full items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-left text-xs text-red-800"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{alerts[0].event}</span>
                {alerts.length > 1 && (
                  <span className="rounded-full bg-red-200 px-1.5 py-0.5 text-[10px] font-medium">
                    +{alerts.length - 1}
                  </span>
                )}
              </div>
              {expandedAlert && alerts[0].headline && (
                <p className="mt-1 text-[11px] leading-snug">{alerts[0].headline}</p>
              )}
            </div>
          </button>
        )}

        <div>
          <div className={`flex items-center gap-2 text-sm ${windColor}`}>
            <Wind size={14} aria-hidden />
            <span className="font-medium">
              {windSpeed} mph {latest.wind_direction_text ?? ""}
            </span>
            <span
              aria-hidden
              className="inline-block"
              style={{
                transform: `rotate(${latest.wind_direction_deg ?? 0}deg)`,
              }}
            >
              ↑
            </span>
          </div>
          {windSpeed > 25 && (
            <p className="mt-1 text-xs text-red-700">Strong wind — use caution on open water</p>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm">
            <CloudRain size={14} aria-hidden />
            <span className="font-medium">{precip}% chance of rain</span>
          </div>
          {precip > 40 && (
            <p className="mt-1 text-xs text-amber-700">
              Rain likely — water quality may be affected after rain events
            </p>
          )}
          {latest.short_forecast && (
            <p className="mt-1 text-xs text-muted-foreground">{latest.short_forecast}</p>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}
