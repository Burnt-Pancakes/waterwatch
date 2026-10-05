/**
 * Shared types and contract for WaterVoice DMV data-source adapters.
 *
 * Every external data source (USGS Water Quality Portal, Arlington County
 * CSV drops, NOAA rainfall, OpenStreetMap POIs) is wrapped in an adapter
 * implementing {@link DataSourceAdapter}. The orchestrator (`runIngestion`)
 * only knows about this interface — adapters are otherwise independent and
 * can be tested in isolation by mocking `fetch`.
 */

/** Normalized site record produced by an adapter, prior to DB upsert. */
export type AdapterSite = {
  /** Stable identifier from the source system (e.g. USGS site code, OSM id). */
  externalId: string;
  name: string;
  lat: number;
  lng: number;
  /** Mirrors `sites.water_body_type` — `freshwater` or `tidal_brackish`. */
  waterBodyType: "freshwater" | "tidal_brackish";
  /** Mirrors `sites.site_type`. */
  siteType: "kayak_launch" | "boat_ramp" | "beach" | "swim_area" | "fishing_access" | "marina";
};

/** Normalized bacteria reading produced by an adapter, prior to DB upsert. */
export type AdapterReading = {
  /** Adapter's identifier for the site this reading belongs to. */
  externalSiteId: string;
  /** ISO timestamp of when the sample was collected (NOT ingested). */
  sampledAt: string;
  /** E. coli (MPN / 100mL). Null when this adapter doesn't report it. */
  eColiMpn: number | null;
  /** Enterococci (CCE / 100mL). Null when this adapter doesn't report it. */
  enterococciCce: number | null;
  /** Free-form description of how the sample was taken, when available. */
  sampleMethod: string | null;
  /** Deep link back to the source system for audit / citation. */
  sourceUrl: string | null;
  /** Original payload row, stored verbatim for forensics. */
  rawPayload: unknown;
};

/**
 * Contract every data-source adapter must implement.
 *
 * Adapters are pure-ish: they call the network and parse responses, but
 * they do NOT write to the database. The orchestrator owns persistence so
 * upsert semantics and status computation stay in one place.
 */
export interface DataSourceAdapter {
  /** Short, stable id (e.g. `"usgs_wqp"`) — also stored on each reading. */
  sourceId: string;
  /** Human-readable name for logs and admin UI. */
  displayName: string;
  /** Discover sites the source knows about (may be a no-op for some). */
  fetchSites(): Promise<AdapterSite[]>;
  /** Fetch readings for a site since the given cutoff (exclusive). */
  fetchReadings(siteId: string, since: Date): Promise<AdapterReading[]>;
  /** Convert a single raw record into the normalized shape. */
  normalize(raw: unknown): AdapterReading;
}

/** Outcome returned by an orchestrator run, summarising every adapter. */
export type IngestionResult = {
  sourcesRun: string[];
  readingsInserted: number;
  readingsSkipped: number;
  errors: Array<{ source: string; message: string }>;
};
