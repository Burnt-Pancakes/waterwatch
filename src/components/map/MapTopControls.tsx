import { MapSearchBox, type PlaceResult, type SearchSelection } from "./MapSearchBox";
import { MapFilterPill } from "./MapFilterPill";
import type { SiteTypeFilter } from "./filterSites";
import type { SiteFeature } from "./types";

type Props = {
  sites: SiteFeature[];
  getCenter: () => [number, number];
  onSelectSite: (site: SiteFeature) => void;
  onSelectPlace: (place: PlaceResult) => void;
  mapClickToken: number;
  filter: SiteTypeFilter;
  onFilterChange: (next: SiteTypeFilter) => void;
  selectedDisplay?: SearchSelection;
};

/**
 * Unified top-left control surface: search field on top, type-filter chips
 * directly beneath. One absolute container owns both so they never collide
 * with the right-side controls (zoom/locate at right-4, style switcher at
 * right-4 top-4). The wrapper is pointer-events-none so map pan/pinch works
 * in the gaps; each interactive child restores pointer-events-auto.
 *
 * right:80px leaves a ~20px gap to the zoom button column (left edge ~330px
 * on a 390px viewport).
 */
export function MapTopControls({
  sites,
  getCenter,
  onSelectSite,
  onSelectPlace,
  mapClickToken,
  filter,
  onFilterChange,
  selectedDisplay,
}: Props) {
  return (
    <div
      className="pointer-events-none absolute left-4 right-4 z-30 flex items-center gap-2"
      style={{ bottom: "calc(64px + env(safe-area-inset-bottom) + 12px + var(--focus-group-bar-height, 0px))" }}
    >
      <div className="min-w-0 flex-1">
        <MapSearchBox
          sites={sites}
          getCenter={getCenter}
          onSelectSite={onSelectSite}
          onSelectPlace={onSelectPlace}
          mapClickToken={mapClickToken}
          selectedDisplay={selectedDisplay}
        />
      </div>
      <MapFilterPill value={filter} onChange={onFilterChange} />
    </div>
  );
}
