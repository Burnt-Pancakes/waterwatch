import { useState } from "react";
import { classifyNettleBand, NETTLE_BAND_COLORS, isNettleObservationStale } from "../thresholds";
import { POPUP } from "../content";
import type { NettleObservation } from "../types";

type Props = {
  observation: NettleObservation;
};

/**
 * Circle marker at a CBIBS buoy position, colored by probability band.
 * Rendered inside a MapLibre `Marker` the same way SiteMarker is (see
 * src/components/map/WaterVoiceMap.tsx) — plain HTMLElement host, React
 * root inside it.
 *
 * The popup is a self-contained absolutely-positioned card toggled by local
 * state rather than a native MapLibre Popup: the map's MapLibreClient type
 * (WaterVoiceMap.tsx) only exposes Map/Marker, and this avoids widening that
 * shared surface for one layer.
 */
export function SeaNettleMarker({ observation }: Props) {
  const [open, setOpen] = useState(false);
  const band = classifyNettleBand(observation.probability);
  const color = NETTLE_BAND_COLORS[band];
  const stale = isNettleObservationStale(observation.observedAt);
  const roundedPct = Math.round(observation.probability);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${observation.stationName ?? observation.stationCode}: ${POPUP.headline(observation.probability)}`}
        data-testid="sea-nettle-marker"
        data-band={band}
        data-stale={stale}
        className="grid h-6 w-6 place-items-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
      />
      {open && (
        <div
          className="absolute bottom-8 left-1/2 z-10 w-64 -translate-x-1/2 rounded-lg bg-card p-3 text-sm text-card-foreground shadow-lg ring-1 ring-border"
          role="dialog"
        >
          <p className="font-semibold">{POPUP.headline(observation.probability)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{POPUP.disclaimer}</p>
          <p className="mt-2 text-xs">
            {new Date(observation.observedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {stale && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
                ({POPUP.staleLabel})
              </span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {observation.stationName ?? observation.stationCode} · {roundedPct}%
          </p>
        </div>
      )}
    </div>
  );
}
