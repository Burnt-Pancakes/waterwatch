import { useState } from "react";
import { Info, Thermometer } from "@/components/icons";
import { cn } from "@/lib/utils";
import { CollapsibleCard } from "@/components/site/CollapsibleCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CARD_TITLE,
  AGE_LABEL,
  THERMAL_PROTECTION_NOTE,
  DISCLAIMER,
  NO_STATION_BODY,
  PROVISIONAL_QUALIFIER,
} from "../content";
import {
  bandForTempC,
  formatTempF,
  BAND_COLOR,
  THERMAL_PROTECTION_THRESHOLD_C,
  LOCAL_READING_MAX_KM,
} from "../thresholds";
import { useWaterTempData } from "../useWaterTempData";
import { WaterTempExplainer } from "./WaterTempExplainer";

type Props = { lat: number; lng: number };

function readingAgeMinutes(observedAt: string): number {
  return Math.round((Date.now() - Date.parse(observedAt)) / 60_000);
}

function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="About water temperature data"
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
    >
      <Info size={13} aria-hidden />
    </button>
  );
}

export function WaterTempBanner({ lat, lng }: Props) {
  const { reading, isLoading } = useWaterTempData(lat, lng);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const explainerDialog = (
    <Dialog open={explainerOpen} onOpenChange={setExplainerOpen}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Water temperature — about this data</DialogTitle>
        </DialogHeader>
        <WaterTempExplainer />
      </DialogContent>
    </Dialog>
  );

  // Loading: CollapsibleCard skeleton, no (i) yet
  if (isLoading) {
    return (
      <CollapsibleCard testId="water-temp-banner" title={CARD_TITLE} loading>
        <div />
      </CollapsibleCard>
    );
  }

  // No-gauge: first-class render for the 287 sites with no station within 30 km.
  // Not an error, not a failure — seasonal guidance + (i) to full explainer.
  if (!reading) {
    return (
      <>
        {explainerDialog}
        <section
          data-testid="water-temp-no-gauge"
          className="overflow-hidden rounded-lg border border-border bg-card dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Thermometer size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground dark:text-white">
                {CARD_TITLE}
              </h3>
            </div>
            <InfoButton onClick={() => setExplainerOpen(true)} />
          </div>
          <div className="space-y-2 px-4 pb-4">
            <p className="text-xs font-medium text-muted-foreground">
              No water temperature station within 30 km
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{NO_STATION_BODY}</p>
          </div>
        </section>
      </>
    );
  }

  const band = bandForTempC(reading.tempC);
  const colors = BAND_COLOR[band.id];
  const belowThreshold = reading.tempC < THERMAL_PROTECTION_THRESHOLD_C;

  return (
    <>
      {explainerDialog}
      {/* Relative wrapper so the (i) button can sit over the CollapsibleCard header.
          The (i) uses stopPropagation to avoid toggling the card on click. */}
      <div className="relative">
        <CollapsibleCard
          testId="water-temp-banner"
          title={CARD_TITLE}
          icon={<Thermometer size={16} aria-hidden className="shrink-0 text-muted-foreground" />}
          summary={
            <span className="mr-7 shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
              {formatTempF(reading.tempC)}
            </span>
          }
          defaultOpen={true}
        >
          <div className="flex items-baseline gap-2">
            <span
              data-testid="water-temp-value"
              className="text-2xl font-bold tabular-nums text-foreground dark:text-white"
            >
              {formatTempF(reading.tempC)}
            </span>
            <span className="text-sm text-muted-foreground">{reading.tempC.toFixed(1)}°C</span>
            <span
              className={cn(
                "ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold",
                colors.badge,
              )}
            >
              {band.label}
            </span>
          </div>

          {belowThreshold && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {THERMAL_PROTECTION_NOTE}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground">
            {reading.source === "usgs" ? "Nearest gauge" : "Nearest buoy"}
            {": "}
            {reading.stationName}
            {", "}
            {reading.distanceKm.toFixed(1)} km
            {reading.distanceKm > LOCAL_READING_MAX_KM ? " (regional)" : ""}
            {" · "}
            {AGE_LABEL(readingAgeMinutes(reading.observedAt))}
            {" · "}
            {PROVISIONAL_QUALIFIER}
          </p>

          <p className="text-[10px] italic text-muted-foreground">{DISCLAIMER}</p>
        </CollapsibleCard>

        {/* (i) button: absolutely positioned between the summary badge and the chevron.
            right-9 (36px) clears the chevron (16px icon + 16px padding = 32px from right).
            stopPropagation prevents the CollapsibleCard toggle from firing. */}
        <button
          type="button"
          aria-label="About water temperature data"
          onClick={(e) => {
            e.stopPropagation();
            setExplainerOpen(true);
          }}
          className="absolute right-9 top-3 z-10 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
        >
          <Info size={13} aria-hidden />
        </button>
      </div>
    </>
  );
}
