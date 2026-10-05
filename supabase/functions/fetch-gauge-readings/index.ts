/**
 * fetch-gauge-readings — pulls the last 24h of USGS Instantaneous Values
 * (gage height 00065, discharge 00060) for every row in river_gauges and
 * upserts them into gauge_readings.
 *
 * Trigger via HTTP POST (no body required). Returns a JSON summary.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO: Add shared-secret auth check (see send-alerts/index.ts)
// Tracked: unauthenticated edge function — Supabase security linter warning
// Deferred: cron-triggered functions; public civic data; low exploit value

interface UsgsValue {
  dateTime: string;
  value: string;
}

interface UsgsTimeSeries {
  variable: { variableCode: Array<{ value: string }> };
  values: Array<{ value: UsgsValue[] }>;
}

interface UsgsResponse {
  value: { timeSeries: UsgsTimeSeries[] };
}

interface GaugeRow {
  id: string;
  usgs_site_number: string;
  name: string;
}

interface ParsedValue {
  dateTime: string;
  value: number;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PARAM_STAGE = "00065";
const PARAM_FLOW = "00060";
const TREND_THRESHOLD_FT = 0.1;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseSeries(payload: UsgsResponse, paramCode: string): ParsedValue[] {
  const series = payload?.value?.timeSeries ?? [];
  for (const ts of series) {
    const code = ts?.variable?.variableCode?.[0]?.value;
    if (code !== paramCode) continue;
    const values = ts?.values?.[0]?.value ?? [];
    return values
      .map((v: UsgsValue) => ({
        dateTime: v.dateTime,
        value: parseFloat(v.value),
      }))
      .filter((v) => Number.isFinite(v.value));
  }
  return [];
}

async function ingestGauge(db: ReturnType<typeof createClient>, gauge: GaugeRow) {
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?sites=${gauge.usgs_site_number}` +
    `&parameterCd=${PARAM_STAGE},${PARAM_FLOW}&format=json&period=PT24H`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return { gauge: gauge.usgs_site_number, error: `USGS ${res.status}`, inserted: 0 };
  }
  const payload = (await res.json()) as UsgsResponse;

  const stages = parseSeries(payload, PARAM_STAGE);
  const flows = parseSeries(payload, PARAM_FLOW);

  // Merge by timestamp.
  const byTime = new Map<string, { stage: number | null; flow: number | null }>();
  for (const s of stages) byTime.set(s.dateTime, { stage: s.value, flow: null });
  for (const f of flows) {
    const existing = byTime.get(f.dateTime);
    if (existing) existing.flow = f.value;
    else byTime.set(f.dateTime, { stage: null, flow: f.value });
  }

  // Sort ascending so trend is computed against the previous reading.
  const entries = Array.from(byTime.entries()).sort(([a], [b]) => Date.parse(a) - Date.parse(b));

  const rows = entries.map(([dateTime, v], i) => {
    let trend: "rising" | "falling" | "steady" | null = null;
    if (i > 0 && v.stage != null) {
      const prevStage = entries[i - 1][1].stage;
      if (prevStage != null) {
        const d = v.stage - prevStage;
        trend = d > TREND_THRESHOLD_FT ? "rising" : d < -TREND_THRESHOLD_FT ? "falling" : "steady";
      }
    }
    return {
      station_id: gauge.id,
      recorded_at: dateTime,
      stage_ft: v.stage,
      flow_cfs: v.flow,
      trend,
    };
  });

  if (rows.length === 0) {
    return { gauge: gauge.usgs_site_number, inserted: 0 };
  }

  const { error } = await db
    .from("gauge_readings")
    .upsert(rows, { onConflict: "station_id,recorded_at", ignoreDuplicates: true });

  if (error) {
    return { gauge: gauge.usgs_site_number, error: error.message, inserted: 0 };
  }
  return { gauge: gauge.usgs_site_number, inserted: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: gauges, error } = await db
    .from("river_gauges")
    .select("id, usgs_site_number, name")
    .not("usgs_site_number", "like", "NOAA-%");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all((gauges ?? []).map((g: GaugeRow) => ingestGauge(db, g)));

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
