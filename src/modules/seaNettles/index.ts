/**
 * Sea Nettles module — public API.
 * Nothing outside this module imports from any other file in src/modules/seaNettles/.
 */

export type { NettleObservation, NettleBand } from "./types";

export {
  NETTLE_STALE_HOURS,
  NETTLE_BAND_COLORS,
  NETTLE_BAND_LABELS,
  classifyNettleBand,
  isNettleObservationStale,
} from "./thresholds";

export { TOGGLE_LABEL, POPUP, TOAST } from "./content";

export { useSeaNettleData } from "./useSeaNettleData";

export { SeaNettleMarker } from "./components/SeaNettleMarker";
export { SeaNettleToggle } from "./components/SeaNettleToggle";
