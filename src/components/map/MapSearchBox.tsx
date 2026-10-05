import { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Loader2, MapPin, Search, Star, X } from "@/components/icons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { SiteFeature } from "./types";
import { SITE_TYPE_ICONS } from "./siteMarkerConstants";
import type { SiteType } from "./siteMarkerConstants";

export type PlaceResult = {
  display_name: string;
  short_name: string;
  lat: number;
  lon: number;
};

export type SearchSelection =
  | { kind: "site"; name: string; siteType: string; siteId: string }
  | { kind: "place"; name: string }
  | null;

type Props = {
  sites: SiteFeature[];
  getCenter: () => [number, number];
  onSelectSite: (site: SiteFeature) => void;
  onSelectPlace: (place: PlaceResult) => void;
  mapClickToken: number;
  selectedDisplay?: SearchSelection;
};

const NOMINATIM =
  "https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=us&viewbox=-77.5,38.5,-76.5,39.2&bounded=0&q=";

const RECENTS_KEY = "watervoice:map:recent-searches";
const RECENTS_MAX = 3;

type RecentItem =
  | { kind: "site"; id: string; name: string; siteType: string }
  | { kind: "place"; name: string; display_name: string; lat: number; lon: number };

function loadRecents(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentItem[]).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecents(items: RecentItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, RECENTS_MAX)));
  } catch {
    /* ignore */
  }
}

function pushRecent(prev: RecentItem[], item: RecentItem): RecentItem[] {
  const key = (r: RecentItem) => (r.kind === "site" ? `site:${r.id}` : `place:${r.lat},${r.lon}`);
  const k = key(item);
  const filtered = prev.filter((r) => key(r) !== k);
  return [item, ...filtered].slice(0, RECENTS_MAX);
}

function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function shortenPlace(display: string): string {
  return display.split(",").slice(0, 2).join(",").trim();
}

const SITE_TYPE_LABEL: Record<string, string> = {
  kayak_launch: "Kayak launch",
  boat_ramp: "Boat ramp",
  beach: "Beach",
  swim_area: "Swim area",
  fishing_access: "Fishing access",
  marina: "Marina",
};

function SelectedChip({
  selection,
  onSearchClick,
}: {
  selection: NonNullable<SearchSelection>;
  onSearchClick: () => void;
}) {
  const Icon =
    selection.kind === "site"
      ? (SITE_TYPE_ICONS[selection.siteType as SiteType] ?? Anchor)
      : MapPin;
  const { user } = useAuth();
  const authenticated = !!user;
  const siteId = selection.kind === "site" ? selection.siteId : null;
  const [starred, setStarred] = useState(false);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    if (!siteId || !authenticated) {
      setStarred(false);
      return;
    }
    let active = true;
    void (async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) return;
      const { data } = await supabase
        .from("favorites")
        .select("id")
        .eq("site_id", siteId)
        .eq("user_id", u.id)
        .maybeSingle();
      if (active) setStarred(!!data);
    })();
    return () => {
      active = false;
    };
  }, [siteId, authenticated]);

  const onSaveClick = async () => {
    if (!siteId) return;
    if (!authenticated) {
      setShowTip(true);
      window.setTimeout(() => setShowTip(false), 2200);
      return;
    }
    const next = !starred;
    setStarred(next);
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    if (!u) {
      setStarred(!next);
      return;
    }
    if (next) {
      const { error } = await supabase.from("favorites").insert({ site_id: siteId, user_id: u.id });
      if (error) {
        setStarred(false);
        toast.error("Could not save favorite");
      } else {
        toast.success("Saved to favorites");
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("site_id", siteId)
        .eq("user_id", u.id);
      if (error) {
        setStarred(true);
        toast.error("Could not remove favorite");
      }
    }
  };

  return (
    <div
      className="relative inline-flex h-9 max-w-full items-center gap-2 overflow-hidden rounded-full pl-3 pr-1 shadow-md ring-1 ring-teal-200 dark:ring-teal-900"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgb(168 242 220) 0%, rgb(160 244 224) 50%, rgb(153 246 228) 100%)",
        backgroundSize: "200% 100%",
        backgroundPosition: "0% 50%",
        animation:
          "watervoice-chip-in 260ms cubic-bezier(0.22, 1, 0.36, 1), watervoice-gradient-pan 600ms ease-out forwards",
      }}
      aria-label={`Selected: ${selection.name}`}
    >
      <Icon
        size={16}
        className="shrink-0 text-teal-700 dark:text-teal-300"
        style={{ animation: "watervoice-icon-slide 260ms ease-out both" }}
        aria-hidden
      />
      <div
        className="min-w-0 truncate text-sm font-semibold text-teal-900 dark:text-teal-100"
        style={{ animation: "watervoice-fade-in 320ms ease-out 80ms both" }}
      >
        {selection.name}
      </div>
      <div
        className="ml-1 flex h-7 items-center gap-0.5 border-l border-teal-200/80 pl-1 dark:border-teal-800/80"
        style={{ animation: "watervoice-fade-in 320ms ease-out 140ms both" }}
      >
        <button
          type="button"
          aria-label="Search"
          onClick={onSearchClick}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-teal-700 transition-colors hover:bg-teal-100/80 dark:text-teal-200 dark:hover:bg-teal-900/60"
        >
          <Search size={14} />
        </button>
        {siteId && (
          <button
            type="button"
            aria-label={starred ? "Remove from favorites" : "Save to favorites"}
            aria-pressed={starred}
            onClick={onSaveClick}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
              starred
                ? "text-teal-500 hover:bg-teal-100 dark:text-teal-400 dark:hover:bg-teal-900/60"
                : "text-teal-700 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-900/60"
            }`}
          >
            <Star
              size={14}
              fill={starred ? "currentColor" : "none"}
              color="currentColor"
              strokeWidth={2}
            />
          </button>
        )}
      </div>
      {showTip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md"
        >
          Sign in to save favorites
        </div>
      )}
    </div>
  );
}

// Returns the collapsed width for the current viewport — 160px on mobile, 200px on desktop.
function useCollapsedWidth(): number {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 640 ? 160 : 200;
    }
    return 200;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setWidth(mq.matches ? 160 : 200);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return width;
}

export function MapSearchBox({
  sites,
  getCenter,
  onSelectSite,
  onSelectPlace,
  mapClickToken,
  selectedDisplay = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const collapsedWidth = useCollapsedWidth();

  const trimmed = query.trim();
  const [recents, setRecents] = useState<RecentItem[]>(() => loadRecents());

  // Whenever a site is selected (from search OR map marker), record it as a recent.
  useEffect(() => {
    if (!selectedDisplay || selectedDisplay.kind !== "site") return;
    const site = sites.find((s) => s.properties.name === selectedDisplay.name);
    if (!site) return;
    setRecents((prev) => {
      const next = pushRecent(prev, {
        kind: "site",
        id: site.properties.id,
        name: site.properties.name,
        siteType: site.properties.site_type,
      });
      saveRecents(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDisplay]);
  // Show the input pill when the user has focused it or has typed text.
  // When a selection is present and the user isn't actively searching, show the chip view instead.
  const searching = focused || query.length > 0;
  const showChip = !searching && selectedDisplay !== null;
  const expanded = searching || showChip;
  const active = focused && trimmed.length >= 2;

  // Site matches (client-side)
  const siteMatches = useMemo(() => {
    if (trimmed.length < 2) return [];
    const q = trimmed.toLowerCase();
    const center = getCenter();
    return sites
      .filter((s) => s.properties.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((s) => ({
        site: s,
        distance: haversineMiles(center, s.geometry.coordinates),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, sites]);

  // Debounced Nominatim search
  useEffect(() => {
    if (trimmed.length < 2) {
      setPlaces([]);
      setPlacesLoading(false);
      return;
    }
    setPlacesLoading(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(NOMINATIM + encodeURIComponent(trimmed), {
          signal: controller.signal,
          headers: {
            "User-Agent": "WaterVoiceDMV/1.0 (water-voice-dmv.lovable.app)",
          },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Array<{
          display_name: string;
          lat: string;
          lon: string;
        }>;
        setPlaces(
          data.map((p) => ({
            display_name: p.display_name,
            short_name: shortenPlace(p.display_name),
            lat: parseFloat(p.lat),
            lon: parseFloat(p.lon),
          })),
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setPlaces([]);
        }
      } finally {
        setPlacesLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [trimmed]);

  // Map tap is an explicit dismissal — clear query so expanded goes false.
  useEffect(() => {
    if (mapClickToken === 0) return;
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }, [mapClickToken]);

  // Reset highlight when results change
  useEffect(() => {
    setHighlight(0);
  }, [trimmed, places.length, siteMatches.length]);

  // Flatten results for keyboard nav
  const flat: Array<
    { kind: "site"; site: SiteFeature; distance: number } | { kind: "place"; place: PlaceResult }
  > = [
    ...siteMatches.map((m) => ({ kind: "site" as const, site: m.site, distance: m.distance })),
    ...places.map((p) => ({ kind: "place" as const, place: p })),
  ];

  const selectIndex = (i: number) => {
    const item = flat[i];
    if (!item) return;
    if (item.kind === "site") {
      setQuery("");
      setFocused(false);
      inputRef.current?.blur();
      const next = pushRecent(recents, {
        kind: "site",
        id: item.site.properties.id,
        name: item.site.properties.name,
        siteType: item.site.properties.site_type,
      });
      setRecents(next);
      saveRecents(next);
      onSelectSite(item.site);
    } else {
      setQuery(item.place.short_name);
      setFocused(false);
      inputRef.current?.blur();
      const next = pushRecent(recents, {
        kind: "place",
        name: item.place.short_name,
        display_name: item.place.display_name,
        lat: item.place.lat,
        lon: item.place.lon,
      });
      setRecents(next);
      saveRecents(next);
      onSelectPlace(item.place);
    }
  };

  const selectRecent = (r: RecentItem) => {
    if (r.kind === "site") {
      const site = sites.find((s) => s.properties.id === r.id);
      if (!site) return;
      setQuery("");
      setFocused(false);
      inputRef.current?.blur();
      const next = pushRecent(recents, r);
      setRecents(next);
      saveRecents(next);
      onSelectSite(site);
    } else {
      setQuery(r.name);
      setFocused(false);
      inputRef.current?.blur();
      const next = pushRecent(recents, r);
      setRecents(next);
      saveRecents(next);
      onSelectPlace({
        display_name: r.display_name,
        short_name: r.name,
        lat: r.lat,
        lon: r.lon,
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectIndex(highlight);
    } else if (e.key === "Escape") {
      // Escape is an explicit dismissal — always collapse and clear text.
      setQuery("");
      setFocused(false);
      inputRef.current?.blur();
    } else if (e.key === "Tab") {
      setFocused(false);
    }
  };

  const showRecents = focused && trimmed.length < 2 && recents.length > 0;
  const showDropdown = active || showRecents;
  const noResults = active && !placesLoading && siteMatches.length === 0 && places.length === 0;

  let runningIndex = 0;

  return (
    <>
      <div
        ref={containerRef}
        className={`pointer-events-auto relative ${showChip ? "flex w-fit min-w-0 max-w-full" : ""}`}
        style={{
          width: showChip ? undefined : expanded ? "100%" : `${collapsedWidth}px`,
          transition: "width 200ms ease-out, opacity 150ms ease",
        }}
      >
        {showChip ? (
          <SelectedChip
            selection={selectedDisplay!}
            onSearchClick={() => {
              setFocused(true);
              // Defer focus so the input is mounted before we focus it.
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        ) : (
          <div
            className={`flex h-9 items-center gap-2 rounded-full px-3 shadow-md ring-1 backdrop-blur-md transition-[background-color,box-shadow] duration-150 ${
              expanded
                ? "bg-white ring-2 ring-teal-500 dark:bg-gray-900"
                : "bg-white/95 ring-black/20 dark:bg-gray-900/95 dark:ring-white/25"
            }`}
          >
            <Search size={16} className="shrink-0 text-gray-400" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                // Auto-collapse only when empty; if text is present the user is mid-search.
                // Explicit dismissals (Escape, map tap, result select) handle the other cases.
                if (query.trim().length === 0) setFocused(false);
              }}
              onKeyDown={onKeyDown}
              placeholder={expanded ? "Search sites and places..." : "Search..."}
              aria-label="Search sites and places"
              className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
            />
            {expanded && query.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {showDropdown && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-80 overflow-y-auto rounded-2xl bg-white shadow-lg ring-1 ring-black/5 dark:bg-gray-900"
          >
            {noResults && <div className="px-4 py-3 text-sm text-gray-500">No results found</div>}

            {showRecents && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Recent
                </div>
                {recents.slice(0, RECENTS_MAX).map((r) => {
                  const key = r.kind === "site" ? `r-site-${r.id}` : `r-place-${r.lat},${r.lon}`;
                  const Icon =
                    r.kind === "site"
                      ? (SITE_TYPE_ICONS[r.siteType as SiteType] ?? Anchor)
                      : MapPin;
                  const subtitle =
                    r.kind === "site" ? (SITE_TYPE_LABEL[r.siteType] ?? r.siteType) : "Place";
                  return (
                    <div
                      key={key}
                      className="group relative flex w-full items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    >
                      <button
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectRecent(r)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <Icon size={16} className="shrink-0 text-gray-500" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {r.name}
                          </div>
                          <div className="truncate text-xs text-gray-500">{subtitle}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${r.name} from recents`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = recents.filter((x) =>
                            x.kind === "site" && r.kind === "site"
                              ? x.id !== r.id
                              : x.kind === "place" && r.kind === "place"
                                ? !(x.lat === r.lat && x.lon === r.lon)
                                : true,
                          );
                          setRecents(next);
                          saveRecents(next);
                        }}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {siteMatches.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Water access sites
                </div>
                {siteMatches.map(({ site, distance }) => {
                  const idx = runningIndex++;
                  const isActive = idx === highlight;
                  return (
                    <button
                      key={site.properties.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectIndex(idx)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                        isActive ? "bg-teal-50 dark:bg-teal-900/30" : ""
                      }`}
                    >
                      <MapPin size={16} className="shrink-0 text-teal-600" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {site.properties.name}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {SITE_TYPE_LABEL[site.properties.site_type] ?? site.properties.site_type}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-gray-500">{distance.toFixed(1)} mi</div>
                    </button>
                  );
                })}
              </>
            )}

            {(places.length > 0 || placesLoading) && (
              <>
                <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Nearby places
                  {placesLoading && (
                    <Loader2 size={12} className="animate-spin text-gray-400" aria-hidden />
                  )}
                </div>
                {places.map((p) => {
                  const idx = runningIndex++;
                  const isActive = idx === highlight;
                  return (
                    <button
                      key={`${p.lat},${p.lon}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectIndex(idx)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                        isActive ? "bg-teal-50 dark:bg-teal-900/30" : ""
                      }`}
                    >
                      <MapPin size={16} className="shrink-0 text-gray-400" aria-hidden />
                      <div className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                        {p.short_name}
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
