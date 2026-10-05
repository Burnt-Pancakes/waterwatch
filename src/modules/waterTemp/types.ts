export type TempBandId = "extreme" | "maximum" | "high" | "caution" | "lower";

export interface TempBand {
  readonly id: TempBandId;
  readonly maxC: number;
  readonly label: string;
}

export interface WaterTempReading {
  tempC: number;
  observedAt: string; // ISO 8601
  stationName: string;
  source: string;
  distanceKm: number;
}

export interface WaterTempState {
  reading: WaterTempReading | null;
  isLoading: boolean;
  error: string | null;
}
