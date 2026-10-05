// supabase/functions/ingest-cmc/index.ts
//
// WaterVoice DMV — CMC ingestion RECEIVER.
//
// WHY THIS EXISTS:
//   CMC's server (vims.edu, Microsoft-IIS) resets TCP connections from cloud
//   datacenter IPs, so a Supabase/AWS function CANNOT fetch CMC directly. The
//   fetch must originate from a residential IP. This function is the other half:
//   a residential client (cmc-push.mjs on Task Scheduler, or a Pi/EC2 later)
//   fetches CMC from a non-datacenter IP and POSTs the samples here. This
//   function — running server-side with the service-role key — does station
//   matching, EPA classification, and the upsert into readings.
//
// STATION MATCHING (4-stage cascade, measured against 2026-07-04 CMC export
// of 8,727 samples / 169 stations):
//   1. EXACT      — station_code == WQP prefix + CMC code            (37 codes)
//   2. NORMALIZED — hyphen/dot + case normalization after prefix
//                   strip; CMC API says "PRK.PR-10", WQP imported it
//                   as "...PRK.PR.10"                                (+19 codes)
//   3. COORDINATE — nearest existing station of ANY source within
//                   100 m of the sample's own lat/lng                (+21 codes)
//   4. CREATE     — ~90 CMC stations were never delivered by WQP at
//                   all (nearest existing station is km away). Create
//                   them from the sample's coordinates.              (+~90 codes)
//   After resolution, stations with no site_station_assignments rows get
//   assignments created for active sites within ASSIGN_RADIUS_M (default
//   1500 m), so recovered readings actually light up map pins instead of
//   dying at skipped_no_site.
//
// PORTABILITY (AWS): this handler is the shape you drop into a Lambda behind
//   API Gateway. Only the wrapper changes (Deno.serve -> Lambda handler) and the
//   DB client (supabase-js -> pg). The auth model (shared secret header), the
//   station-matching, classification, and upsert logic all carry over unchanged.
//
// AUTH: x-cron-secret header must equal the CRON_SECRET env var.
//
// REQUEST BODY (JSON):
//   { "samples": [
//       { "stationCode": "ARK.AR.2", "sampledAt": "2026-05-28T08:53:00.000Z",
//         "ecoliMpn": 1046.2, "groupCode": "ARK", "parameterCode": "ECOLI.8",
//         "sampleId": "1", "latitude": 38.8774, "longitude": -77.0246,
//         "rawRow": { ...original CMC record... } },
//       ...
//   ] }
//   latitude/longitude are OPTIONAL; if absent, the function falls back to
//   rawRow.Latitude / rawRow.Longitude (present in CMC API rows), so older
//   clients keep working.
//
// The client sends ecoliMpn and groupCode; this function is the AUTHORITY on
// status (EPA thresholds) and data_source naming — it recomputes both rather
// than trusting client-supplied safety values. Defense in depth for a safety app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CMC_WQP_PREFIX = "CHESAPEAKEMONITORINGCOOP-CMC.";
const MAX_MATCH_DISTANCE_M = 25000; // filter on existing assignments
const COORD_MATCH_M = 100; // stage-3: adopt an existing station this close
const ASSIGN_RADIUS_M = Number(Deno.env.get("ASSIGN_RADIUS_M") ?? "1500"); // new assignments

// EPA freshwater E. coli thresholds (MPN/100mL).
const EPA_GM_THRESHOLD = 235; // caution
const EPA_STV_THRESHOLD = 410; // unsafe

// EPA marine/recreational enterococci thresholds (CCE or CFU/100mL, single-sample
// statistical threshold value). Enterococci is the correct indicator for tidal /
// brackish / marine sites where E. coli under-predicts risk.
const EPA_ENT_GM_THRESHOLD = 35; // caution (geomean basis)
const EPA_ENT_STV_THRESHOLD = 130; // unsafe (single-sample STV)

// CMC GroupCode -> friendly data_source name. Authoritative copy.
const GROUP_DISPLAY: Record<string, string> = {
  ARK: "Anacostia Riverkeeper",
  PRK: "Potomac Riverkeeper",
  ACB: "Anacostia Community Boathouse",
  ACBM: "Anacostia Community Boathouse",
  FMR: "Friends of the Rappahannock",
  SHR: "Shenandoah Riverkeeper",
  TWC: "Two Creeks",
};

function classifyStatus(mpn: number): "pass" | "caution" | "unsafe" {
  if (mpn >= EPA_STV_THRESHOLD) return "unsafe";
  if (mpn >= EPA_GM_THRESHOLD) return "caution";
  return "pass";
}

function classifyEnterococci(cce: number): "pass" | "caution" | "unsafe" {
  if (cce >= EPA_ENT_STV_THRESHOLD) return "unsafe";
  if (cce >= EPA_ENT_GM_THRESHOLD) return "caution";
  return "pass";
}

function groupToDataSource(groupCode: string): string {
  return GROUP_DISPLAY[groupCode] ?? `CMC / ${groupCode}`;
}

// Hyphen/dot/case normalization: "PRK.PR-10" and "PRK.PR.10" both -> "PRK.PR.10"
function normCode(code: string): string {
  return code.replace(/-/g, ".").toUpperCase();
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * p) / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lon2 - lon1) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface IncomingSample {
  stationCode: string;
  sampledAt: string;
  ecoliMpn: number;
  indicator?: "ecoli" | "enterococci"; // new clients set this; default "ecoli"
  value?: number; // generic value for the given indicator
  groupCode: string;
  parameterCode: string;
  sampleId: string;
  latitude?: number;
  longitude?: number;
  rawRow: Record<string, unknown>;
}

function sampleCoords(s: IncomingSample): { lat: number; lng: number } | null {
  let lat = Number(s.latitude);
  let lng = Number(s.longitude);
  if (!isFinite(lat) || !isFinite(lng)) {
    const r = (s.rawRow as any) ?? {};
    // CMC API uses Lat/Long; CSV export uses Latitude/Longitude. Cover both.
    lat = Number(r.Lat ?? r.Latitude ?? r.latitude);
    lng = Number(r.Long ?? r.Longitude ?? r.longitude ?? r.Lng ?? r.lng);
  }
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

Deno.serve(async (req) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const summary: any = {
    started_at: new Date().toISOString(),
    received: 0,
    matched_exact: 0,
    matched_normalized: 0,
    matched_coord: 0,
    stations_created: 0,
    assignments_created: 0,
    matched_stations: 0,
    inserted: 0,
    skipped_no_station: 0,
    skipped_no_site: 0,
    errors: [] as string[],
  };

  try {
    // ── Parse + validate body ────────────────────────────────────────────────
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const samples: IncomingSample[] = Array.isArray(body?.samples) ? body.samples : [];
    summary.received = samples.length;

    if (samples.length === 0) {
      summary.finished_at = new Date().toISOString();
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // One representative coordinate per incoming station code (samples from the
    // same station share coordinates).
    const uniqueCodes = [...new Set(samples.map((s) => String(s.stationCode)))];
    const coordByCode = new Map<string, { lat: number; lng: number }>();
    for (const s of samples) {
      const code = String(s.stationCode);
      if (!coordByCode.has(code)) {
        const c = sampleCoords(s);
        if (c) coordByCode.set(code, c);
      }
    }

    const codeToStationId = new Map<string, string>();

    // ── Stages 1+2: EXACT and NORMALIZED matching, in memory ─────────────────
    // One LIKE query loads all CMC stations (~300 rows). Never pass the sample
    // code list in a URL filter: a historical backfill has hundreds of unique
    // codes and .in() overflows PostgREST's URL limit ("Bad Request").
    {
      const { data: cmcRows, error: cmcErr } = await supabase
        .from("monitoring_stations")
        .select("id, station_code")
        .like("station_code", `${CMC_WQP_PREFIX}%`);
      if (cmcErr) throw new Error(`load stations (cmc): ${cmcErr.message}`);
      const exactToId = new Map<string, string>();
      const normToId = new Map<string, string>();
      for (const ms of (cmcRows || []) as any[]) {
        const bare = ms.station_code.slice(CMC_WQP_PREFIX.length);
        if (!exactToId.has(bare)) exactToId.set(bare, ms.id);
        const key = normCode(bare);
        if (!normToId.has(key)) normToId.set(key, ms.id);
      }
      for (const c of uniqueCodes) {
        const exact = exactToId.get(c);
        if (exact) {
          codeToStationId.set(c, exact);
          summary.matched_exact++;
          continue;
        }
        const normed = normToId.get(normCode(c));
        if (normed) {
          codeToStationId.set(c, normed);
          summary.matched_normalized++;
        }
      }
    }

    // ── Stage 3: COORDINATE — nearest existing station (any source) ≤ 100 m ──
    let unresolved = uniqueCodes.filter((c) => !codeToStationId.has(c));
    let allStations: { id: string; lat: number; lng: number }[] | null = null;
    if (unresolved.length > 0) {
      const { data: stRows, error: stErr } = await supabase
        .from("monitoring_stations")
        .select("id, lat, lng")
        .not("lat", "is", null)
        .not("lng", "is", null);
      if (stErr) throw new Error(`load stations (coords): ${stErr.message}`);
      allStations = ((stRows || []) as any[]).map((r) => ({
        id: r.id,
        lat: Number(r.lat),
        lng: Number(r.lng),
      }));
      for (const c of unresolved) {
        const sc = coordByCode.get(c);
        if (!sc) continue;
        let bestId: string | null = null;
        let bestD = Infinity;
        for (const st of allStations) {
          const d = haversineM(sc.lat, sc.lng, st.lat, st.lng);
          if (d < bestD) {
            bestD = d;
            bestId = st.id;
          }
        }
        if (bestId && bestD <= COORD_MATCH_M) {
          codeToStationId.set(c, bestId);
          summary.matched_coord++;
        }
      }
    }

    // ── Stage 4: CREATE — station absent from DB entirely; make it ───────────
    unresolved = uniqueCodes.filter((c) => !codeToStationId.has(c));
    const creatable = unresolved.filter((c) => coordByCode.has(c));
    if (creatable.length > 0) {
      const groupByCode = new Map<string, string>();
      for (const s of samples) {
        const code = String(s.stationCode);
        if (!groupByCode.has(code) && s.groupCode) groupByCode.set(code, String(s.groupCode));
      }
      const newRows = creatable.map((c) => ({
        station_code: `${CMC_WQP_PREFIX}${c}`,
        station_name: c,
        agency: "CMC",
        org_identifier: "CHESAPEAKEMONITORINGCOOP-CMC",
        data_source: "Chesapeake Monitoring Coop",
        lat: coordByCode.get(c)!.lat,
        lng: coordByCode.get(c)!.lng,
        location_type: "Stream",
        is_tidal: false,
        is_active: true,
        characteristics: ["Escherichia coli"],
      }));
      const { data: created, error: crErr } = await supabase
        .from("monitoring_stations")
        .insert(newRows)
        .select("id, station_code");
      if (crErr) {
        summary.errors.push(`create stations: ${crErr.message}`);
      } else {
        for (const ms of (created || []) as any[]) {
          codeToStationId.set(ms.station_code.replace(CMC_WQP_PREFIX, ""), ms.id);
          summary.stations_created++;
        }
      }
    }

    summary.matched_stations = codeToStationId.size;

    // ── station id -> [site_id] within match radius ──────────────────────────
    // Chunk the .in() filter: a backfill can resolve hundreds of stations and
    // an unchunked list overflows PostgREST's URL limit.
    const stationIds = [...new Set(codeToStationId.values())];
    const sitesByStation = new Map<string, string[]>();
    const ID_CHUNK = 100;
    for (let i = 0; i < stationIds.length; i += ID_CHUNK) {
      const chunk = stationIds.slice(i, i + ID_CHUNK);
      const { data: assigns, error: asErr } = await supabase
        .from("site_station_assignments")
        .select("site_id, station_id, distance_m")
        .in("station_id", chunk)
        .lte("distance_m", MAX_MATCH_DISTANCE_M);
      if (asErr) throw new Error(`load assignments: ${asErr.message}`);
      for (const a of (assigns || []) as any[]) {
        const arr = sitesByStation.get(a.station_id) || [];
        arr.push(a.site_id);
        sitesByStation.set(a.station_id, arr);
      }
    }

    // ── Backfill assignments for resolved stations that have none ────────────
    // Without this, stage-3/4 recoveries (and any WQP import gaps) die at
    // skipped_no_site. Creates rows for active sites within ASSIGN_RADIUS_M.
    const stationCoordById = new Map<string, { lat: number; lng: number }>();
    for (const [code, id] of codeToStationId) {
      const c = coordByCode.get(code);
      if (c && !stationCoordById.has(id)) stationCoordById.set(id, c);
    }
    const unassigned = stationIds.filter(
      (id) => !sitesByStation.has(id) && stationCoordById.has(id),
    );
    if (unassigned.length > 0) {
      const { data: siteRows, error: siErr } = await supabase
        .from("sites")
        .select("id, lat, lng")
        .eq("is_active", true)
        .not("lat", "is", null)
        .not("lng", "is", null);
      if (siErr) {
        summary.errors.push(`load sites: ${siErr.message}`);
      } else {
        const sites = ((siteRows || []) as any[]).map((r) => ({
          id: r.id,
          lat: Number(r.lat),
          lng: Number(r.lng),
        }));
        const newAssigns: Record<string, unknown>[] = [];
        for (const stId of unassigned) {
          const sc = stationCoordById.get(stId)!;
          for (const site of sites) {
            const d = haversineM(sc.lat, sc.lng, site.lat, site.lng);
            if (d <= ASSIGN_RADIUS_M) {
              newAssigns.push({
                site_id: site.id,
                station_id: stId,
                distance_m: Math.round(d),
              });
            }
          }
        }
        if (newAssigns.length > 0) {
          const { error: naErr, count } = await supabase
            .from("site_station_assignments")
            .insert(newAssigns, { count: "exact" });
          if (naErr) {
            summary.errors.push(`create assignments: ${naErr.message}`);
          } else {
            summary.assignments_created = count ?? newAssigns.length;
            for (const a of newAssigns) {
              const arr = sitesByStation.get(a.station_id as string) || [];
              arr.push(a.site_id as string);
              sitesByStation.set(a.station_id as string, arr);
            }
          }
        }
      }
    }

    // ── Build reading rows: MERGE indicators per (station, sampled_at) ────────
    // A single sampling event may report both E. coli and enterococci. The
    // readings table has a column for each, and the dedup key is
    // (site_id, sampled_at, data_source) — so two indicator rows for the same
    // event would collide and one would be dropped. Correct model: one reading
    // row per event carrying BOTH values, with status = worst case of whichever
    // indicators are present. This also matches how a paddler reads a site: the
    // most conservative signal wins.
    const STATUS_RANK: Record<string, number> = { pass: 0, caution: 1, unsafe: 2 };
    const worse = (a: string, b: string) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

    // key: stationId + "|" + sampledAt  ->  merged event
    interface MergedEvent {
      stationId: string;
      sampledAt: string;
      groupCode: string;
      stationCode: string;
      sampleId: string;
      parameterCodes: string[];
      eColi: number | null;
      ent: number | null;
      status: string;
      rawRow: Record<string, unknown>;
    }
    const events = new Map<string, MergedEvent>();

    for (const s of samples) {
      const stationId = codeToStationId.get(String(s.stationCode));
      if (!stationId) {
        summary.skipped_no_station++;
        continue;
      }
      const siteIds = sitesByStation.get(stationId) || [];
      if (siteIds.length === 0) {
        summary.skipped_no_site++;
        continue;
      }

      const indicator = s.indicator === "enterococci" ? "enterococci" : "ecoli";
      const value = Number(s.value ?? s.ecoliMpn);
      if (!isFinite(value) || value < 0) continue;

      const sampledAt = String(s.sampledAt);
      const key = `${stationId}|${sampledAt}`;
      let ev = events.get(key);
      if (!ev) {
        ev = {
          stationId,
          sampledAt,
          groupCode: String(s.groupCode || ""),
          stationCode: String(s.stationCode),
          sampleId: String(s.sampleId ?? ""),
          parameterCodes: [],
          eColi: null,
          ent: null,
          status: "pass",
          rawRow: s.rawRow ?? {},
        };
        events.set(key, ev);
      }
      if (indicator === "enterococci") {
        ev.ent = value;
        ev.status = worse(ev.status, classifyEnterococci(value));
      } else {
        ev.eColi = value;
        ev.status = worse(ev.status, classifyStatus(value));
      }
      if (s.parameterCode) ev.parameterCodes.push(String(s.parameterCode));
    }

    // Expand merged events into reading rows (one per assigned site).
    const rows: Record<string, unknown>[] = [];
    const latestByStation = new Map<string, string>();

    for (const ev of events.values()) {
      const siteIds = sitesByStation.get(ev.stationId) || [];
      const dataSource = groupToDataSource(ev.groupCode);
      for (const siteId of siteIds) {
        rows.push({
          site_id: siteId,
          monitoring_station_id: ev.stationId,
          sampled_at: ev.sampledAt,
          e_coli_mpn: ev.eColi,
          enterococci_cce: ev.ent,
          sample_method: "lab",
          data_source: dataSource,
          source_url: "https://cmc.vims.edu/data-explorer",
          status: ev.status,
          raw_payload: ev.rawRow,
          notes: `CMC ${ev.groupCode} / ${ev.stationCode} / ${ev.parameterCodes.join("+")} / sampleId ${ev.sampleId}`,
        });
      }
      const prev = latestByStation.get(ev.stationId);
      if (!prev || ev.sampledAt > prev) latestByStation.set(ev.stationId, ev.sampledAt);
    }

    // ── Batched upsert with dedup ────────────────────────────────────────────
    if (rows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error: upErr, count } = await supabase.from("readings").upsert(slice, {
          onConflict: "site_id,sampled_at,data_source",
          ignoreDuplicates: true,
          count: "exact",
        });
        if (upErr) summary.errors.push(`upsert batch ${i}: ${upErr.message}`);
        else summary.inserted += count ?? 0;
      }
    }

    // ── Refresh last_sample_at ───────────────────────────────────────────────
    for (const [stationId, ts] of latestByStation) {
      await supabase.from("monitoring_stations").update({ last_sample_at: ts }).eq("id", stationId);
    }

    summary.finished_at = new Date().toISOString();
    console.log("ingest-cmc summary:", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    summary.errors.push(String(e));
    summary.finished_at = new Date().toISOString();
    console.error("ingest-cmc FAILED:", e);
    return new Response(JSON.stringify(summary), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
