import { Thermometer } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { WaterTempReading } from "../types";
import { bandForTempC, formatTempF, BAND_COLOR, LOCAL_READING_MAX_KM } from "../thresholds";
import { SOURCE_LABELS, AGE_LABEL, PROVISIONAL_QUALIFIER } from "../content";

type Props = {
  reading: WaterTempReading | null;
  loading?: boolean;
};

function readingAgeMinutes(observedAt: string): number {
  return Math.round((Date.now() - Date.parse(observedAt)) / 60_000);
}

/** Compact water temperature row for site list views. Renders nothing when no reading and not loading. */
export function WaterTempSiteRow({ reading, loading = false }: Props) {
  if (!loading && !reading) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1" data-testid="water-temp-row-loading">
        <Thermometer size={14} className="text-muted-foreground" aria-hidden />
        <span className="h-3 w-20 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  const band = bandForTempC(reading!.tempC);
  const colors = BAND_COLOR[band.id];
  const isLocal = reading!.distanceKm <= LOCAL_READING_MAX_KM;

  return (
    <div className="flex items-center gap-2 py-1" data-testid="water-temp-row">
      <Thermometer size={14} className="shrink-0 text-muted-foreground" aria-hidden />

      <span className="text-sm font-semibold tabular-nums text-foreground dark:text-white">
        {formatTempF(reading!.tempC)}
      </span>

      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", colors.badge)}>
        {band.label}
      </span>

      <span className="ml-auto text-[10px] text-muted-foreground">
        {SOURCE_LABELS[reading!.source] ?? reading!.source}
        {" · "}
        {reading!.distanceKm.toFixed(1)} km{isLocal ? "" : " (regional)"}
        {" · "}
        {AGE_LABEL(readingAgeMinutes(reading!.observedAt))}
        {" · "}
        {PROVISIONAL_QUALIFIER}
      </span>
    </div>
  );
}
