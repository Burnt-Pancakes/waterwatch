/**
 * fetch-tidal-predictions — fetches 48 hours of high/low tide predictions
 * from NOAA CO-OPS for every NOAA station in river_gauges and upserts them
 * into tidal_predictions.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO: Add shared-secret auth check (see send-alerts/index.ts)
// Tracked: unauthenticated edge function — Supabase security linter warning
// Deferred: cron-triggered functions; public civic data; low exploit value

interface NoaaPrediction {
  t: string;
  v: string;
  type: "H" | "L";
}

interface NoaaResponse {
  predictions: NoaaPrediction[];
}

const PARAMS =
  "product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=watervoice&format=json";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function getNthDayOfMonth(year: number, month: number, dow: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1));
  let date = 1 + ((dow - first.getUTCDay() + 7) % 7);
  date += (n - 1) * 7;
  return date;
}

function easternOffsetForDate(dateStr: string): string {
  // dateStr = "YYYY-MM-DD"
  const [y, m, d] = dateStr.split("-").map(Number);
  const secondSundayMarch = getNthDayOfMonth(y, 3, 0, 2);
  const firstSundayNovember = getNthDayOfMonth(y, 11, 0, 1);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dstStart = Date.UTC(y, 2, secondSundayMarch, 7, 0, 0); // 02:00 ET -> 07:00 UTC
  const dstEnd = Date.UTC(y, 10, firstSundayNovember, 6, 0, 0); // 02:00 ET -> 06:00 UTC (fallback)
  return date >= dstStart && date < dstEnd ? "-04:00" : "-05:00";
}

function parseNoaaDate(t: string): string {
  // t = "YYYY-MM-DD HH:MM" (America/New_York)
  const offset = easternOffsetForDate(t.slice(0, 10));
  return `${t.replace(" ", "T")}:00${offset}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const beginDate = formatYYYYMMDD(new Date());
    const endDate = formatYYYYMMDD(new Date(Date.now() + 7 * 24 * 3600 * 1000));

    const { data: gauges, error: gaugeErr } = await db
      .from("river_gauges")
      .select("usgs_site_number, name")
      .like("usgs_site_number", "NOAA-%");

    if (gaugeErr) {
      return new Response(JSON.stringify({ ok: false, error: gaugeErr.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stations = (gauges ?? [])
      .map((g) => ({ id: String(g.usgs_site_number).replace(/^NOAA-/, ""), name: g.name }))
      .filter((s) => s.id.length > 0);

    const results: Array<Record<string, unknown>> = [];

    for (let i = 0; i < stations.length; i++) {
      const { id: stationId, name } = stations[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 100));

      try {
        const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${stationId}&${PARAMS}&begin_date=${beginDate}&end_date=${endDate}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) {
          results.push({ station: stationId, name, ok: false, error: `HTTP ${res.status}` });
          continue;
        }

        const payload = (await res.json()) as NoaaResponse;
        const predictions = payload?.predictions ?? [];
        if (!Array.isArray(predictions) || predictions.length === 0) {
          results.push({ station: stationId, name, ok: false, error: "No predictions" });
          continue;
        }

        const rows = predictions.map((p: NoaaPrediction) => ({
          noaa_station_id: `NOAA-${stationId}`,
          predicted_at: parseNoaaDate(p.t),
          type: p.type,
          height_ft: parseFloat(p.v),
          fetched_at: new Date().toISOString(),
        }));

        const { error } = await db
          .from("tidal_predictions")
          .upsert(rows, { onConflict: "noaa_station_id,predicted_at" });

        if (error) {
          results.push({ station: stationId, name, ok: false, error: error.message });
        } else {
          results.push({ station: stationId, name, ok: true, upserted: rows.length });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        results.push({ station: stationId, name, ok: false, error: message });
      }
    }

    const totalUpserted = results.reduce(
      (acc, r) => acc + (typeof r.upserted === "number" ? r.upserted : 0),
      0,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        stations: stations.length,
        totalUpserted,
        results,
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
