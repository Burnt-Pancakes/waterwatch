/**
 * fetch-weather — fetches NWS hourly forecast and active alerts for central DC
 * and upserts results into weather_readings and weather_alerts.
 * Emails users who subscribed to weather advisories for affected sites.
 *
 * Does NOT write to rain_events: that table is measured rainfall
 * (see noaaRainAdapter.ts), not forecast precipitation probability.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  notifyWeatherAlertSubscribers,
  type WeatherAlertInfo,
} from "../_shared/weatherAlertNotify.ts";

// TODO: Add shared-secret auth check (see send-alerts/index.ts)
// Tracked: unauthenticated edge function — Supabase security linter warning
// Deferred: cron-triggered functions; public civic data; low exploit value

const LAT = 38.8951;
const LNG = -77.0364;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = Deno.env.get("SITE_URL") ?? "https://watervoice.app";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "WaterVoice DMV <alerts@watervoice.app>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NWS_HEADERS = {
  "User-Agent": "watervoice-dmv (contact@watervoice.app)",
  Accept: "application/geo+json",
};

interface NwsPointsResponse {
  properties: {
    forecastHourly: string;
    relativeLocation: { properties: { city: string; state: string } };
  };
}

interface NwsHourlyPeriod {
  startTime: string;
  temperature: number;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  probabilityOfPrecipitation: { value: number | null } | null;
}

interface NwsHourlyResponse {
  properties: { periods: NwsHourlyPeriod[] };
}

interface NwsAlertFeature {
  id: string;
  properties: {
    event: string;
    severity: string | null;
    urgency: string | null;
    headline: string | null;
    description: string | null;
    effective: string | null;
    expires: string | null;
    areaDesc: string | null;
  };
}

interface NwsAlertsResponse {
  features: NwsAlertFeature[];
}

const DIR_TO_DEG: Record<string, number> = {
  N: 0,
  NNE: 22,
  NE: 45,
  ENE: 67,
  E: 90,
  ESE: 112,
  SE: 135,
  SSE: 157,
  S: 180,
  SSW: 202,
  SW: 225,
  WSW: 247,
  W: 270,
  WNW: 292,
  NW: 315,
  NNW: 337,
};

function parseWindSpeed(s: string): number {
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const pointsRes = await fetch(`https://api.weather.gov/points/${LAT},${LNG}`, {
      headers: NWS_HEADERS,
    });
    if (!pointsRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "NWS points error", status: pointsRes.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const points = (await pointsRes.json()) as NwsPointsResponse;
    const forecastHourlyUrl = points.properties.forecastHourly;

    const hourlyRes = await fetch(forecastHourlyUrl, { headers: NWS_HEADERS });
    if (!hourlyRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "NWS hourly error", status: hourlyRes.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const hourly = (await hourlyRes.json()) as NwsHourlyResponse;
    const periods = (hourly.properties?.periods ?? []).slice(0, 12);
    const nowIso = new Date().toISOString();

    const readingRows = periods.map((p) => ({
      observed_at: p.startTime,
      wind_speed_mph: parseWindSpeed(p.windSpeed),
      wind_direction_text: p.windDirection,
      wind_direction_deg: DIR_TO_DEG[p.windDirection] ?? null,
      precip_probability_pct: p.probabilityOfPrecipitation?.value ?? 0,
      short_forecast: p.shortForecast,
      temperature_f: p.temperature,
      raw_json: p,
      fetched_at: nowIso,
    }));

    let readingsUpserted = 0;
    if (readingRows.length > 0) {
      const { error } = await db
        .from("weather_readings")
        .upsert(readingRows, { onConflict: "observed_at" });
      if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      readingsUpserted = readingRows.length;
    }

    const alertsRes = await fetch(`https://api.weather.gov/alerts/active?point=${LAT},${LNG}`, {
      headers: NWS_HEADERS,
    });
    let alertsUpserted = 0;
    if (alertsRes.ok) {
      const alerts = (await alertsRes.json()) as NwsAlertsResponse;
      const alertRows = (alerts.features ?? []).map((f) => ({
        nws_alert_id: f.id,
        event: f.properties.event,
        severity: f.properties.severity,
        urgency: f.properties.urgency,
        headline: f.properties.headline,
        description: f.properties.description?.slice(0, 500) ?? null,
        effective_at: f.properties.effective,
        expires_at: f.properties.expires,
        area_desc: f.properties.areaDesc,
        lat: LAT,
        lng: LNG,
        raw_json: f.properties,
        fetched_at: nowIso,
      }));
      if (alertRows.length > 0) {
        const { error } = await db
          .from("weather_alerts")
          .upsert(alertRows, { onConflict: "nws_alert_id" });
        if (!error) alertsUpserted = alertRows.length;
      }
    }

    const { data: activeFromDb } = await db
      .from("weather_alerts")
      .select(
        "nws_alert_id, event, severity, urgency, headline, description, effective_at, expires_at, area_desc",
      )
      .gt("expires_at", nowIso);

    const weatherEmailsSent = await notifyWeatherAlertSubscribers(
      db,
      (activeFromDb ?? []) as WeatherAlertInfo[],
      { appUrl: APP_URL, emailFrom: EMAIL_FROM, resendApiKey: RESEND_API_KEY },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        readings_upserted: readingsUpserted,
        alerts_upserted: alertsUpserted,
        weather_emails_sent: weatherEmailsSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
