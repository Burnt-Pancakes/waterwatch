/**
 * Water Temperature module — public API.
 * Nothing outside this module imports from any other file in src/modules/waterTemp/.
 */

export type { TempBandId, TempBand, WaterTempReading, WaterTempState } from "./types";

export {
  WATER_TEMP_BANDS_C,
  THERMAL_PROTECTION_THRESHOLD_C,
  MAX_READING_AGE_HOURS,
  LOCAL_READING_MAX_KM,
  BAND_COLOR,
  bandForTempC,
  cToF,
  formatTempF,
} from "./thresholds";

export { NO_STATION_BODY, PROVISIONAL_QUALIFIER } from "./content";

export { useWaterTempData } from "./useWaterTempData";

export { WaterTempBanner } from "./components/WaterTempBanner";
export { WaterTempSiteRow } from "./components/WaterTempSiteRow";
export { WaterTempExplainer } from "./components/WaterTempExplainer";
