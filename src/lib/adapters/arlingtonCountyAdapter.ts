/**
 * Arlington County water quality CSV adapter.
 *
 * Arlington County does not yet expose a REST API for the kayak-launch
 * sampling program. Their team currently emails CSV files which we drop
 * into the private Supabase Storage bucket `arlington-data`. This adapter
 * reads the most recent CSV and normalizes it.
 *
 * TODO: Replace with Arlington County REST API when available.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";

/** Required columns we expect in every CSV row. */
const REQUIRED_COLUMNS = [
  "SiteID",
  "SiteName",
  "SampleDate",
  "EColi_MPN",
  "Latitude",
  "Longitude",
] as const;

export type ArlingtonRow = {
  SiteID: string;
  SiteName: string;
  SampleDate: string;
  EColi_MPN: string;
  Latitude: string;
  Longitude: string;
};

/**
 * Minimal RFC 4180-ish CSV parser.
 *
 * We avoid an external dep (papaparse, csv-parse) because the file format
 * is narrow and trusted. Handles quoted fields containing commas + escaped
 * double-quotes (`""`) but does NOT try to be a full CSV implementation.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (field.length || cur.length) {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      }
      // Swallow \r\n as a single break.
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });
}

/** Returns true when every required column has a non-empty value. */
export function isValidArlingtonRow(row: Record<string, string>): boolean {
  return REQUIRED_COLUMNS.every((c) => (row[c] ?? "").trim().length > 0);
}

export class ArlingtonCountyAdapter implements DataSourceAdapter {
  sourceId = "arlington_county";
  displayName = "Arlington County";

  /**
   * @param supabase Admin Supabase client capable of reading the
   *   private `arlington-data` storage bucket. Injected so tests can
   *   pass a fake.
   * @param objectPath Object key inside the bucket. Defaults to
   *   `latest.csv` so the operations team can simply overwrite one file.
   * @param logger Side-channel for row-level validation warnings.
   */
  constructor(
    private readonly supabase: Pick<SupabaseClient, "storage">,
    private readonly objectPath: string = "latest.csv",
    private readonly logger: Pick<Console, "warn"> = console,
  ) {}

  async fetchSites(): Promise<AdapterSite[]> {
    return [];
  }

  /**
   * Read the CSV from storage and emit one normalized reading per valid row.
   * `since` filters out rows older than the cutoff to keep DB writes minimal.
   */
  async fetchReadings(_siteId: string, since: Date): Promise<AdapterReading[]> {
    const { data, error } = await this.supabase.storage
      .from("arlington-data")
      .download(this.objectPath);
    if (error || !data) {
      throw new Error(
        `Arlington adapter could not download ${this.objectPath}: ${error?.message ?? "no data"}`,
      );
    }
    const text = await data.text();
    const rows = parseCsv(text);
    const out: AdapterReading[] = [];
    rows.forEach((row, idx) => {
      // Row numbers in logs are 1-based and skip the header so they line up
      // with what someone would see opening the CSV in Excel.
      const rowNum = idx + 2;
      if (!isValidArlingtonRow(row)) {
        this.logger.warn(`[arlington_county] Row ${rowNum} rejected — missing required field`);
        return;
      }
      const reading = this.normalize(row);
      if (new Date(reading.sampledAt) < since) return;
      out.push(reading);
    });
    return out;
  }

  normalize(raw: unknown): AdapterReading {
    const r = (raw ?? {}) as Partial<ArlingtonRow>;
    const sampled = new Date(r.SampleDate ?? "");
    const ecoli = r.EColi_MPN ? Number(r.EColi_MPN) : null;
    return {
      externalSiteId: r.SiteID ?? "",
      sampledAt: Number.isNaN(sampled.getTime())
        ? new Date(0).toISOString()
        : sampled.toISOString(),
      eColiMpn: Number.isFinite(ecoli as number) ? (ecoli as number) : null,
      enterococciCce: null,
      sampleMethod: "Arlington County volunteer monitoring",
      sourceUrl: null,
      rawPayload: raw,
    };
  }
}
