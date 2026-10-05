/**
 * A single CBIBS station's latest sea nettle observation, as consumed by the
 * map layer. Mirrors the shape of a `nettle_observations` row, camelCased.
 */
export interface NettleObservation {
  stationCode: string;
  stationName: string | null;
  lat: number;
  lng: number;
  /** ISO 8601 timestamp of the underlying CBIBS measurement. */
  observedAt: string;
  /** Forecast probability, 0-100. Not a bacteria/safety classification. */
  probability: number;
  waterTempC: number | null;
  salinityPsu: number | null;
}

export type NettleBand = "low" | "moderate" | "high" | "very_high";
