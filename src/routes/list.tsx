import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuthNav } from "@/components/auth/AuthNav";
import { SiteBottomSheet } from "@/components/map/SiteBottomSheet";
import { STATUS_PRESENTATION } from "@/components/map/statusPresentation";
import { AppFooter } from "@/components/ui/AppFooter";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { distanceKm } from "@/lib/geo";
import type { SiteFeature, SitesFeatureCollection } from "@/components/map/types";
import type { SiteStatus } from "@/components/map/siteMarkerConstants";

export const Route = createFileRoute("/list")({
  head: () => ({
    meta: [
      { property: "og:title", content: "All sites — WaterWatch DMV" },
      { property: "og:description", content: "Browse and search all monitored water access points." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "All sites — WaterWatch DMV" },
      { name: "description", content: "Browse and search all monitored water access points." },
    ],
  }),
  component: ListPage,
});

const STATUS_SORT_ORDER: Record<SiteStatus, number> = {
  unsafe: 0,
  caution: 1,
  no_data: 2,
  pass: 3,
};

function ListPage() {
  const [sites, setSites] = useState<SiteFeature[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"status" | "name">("status");
  const [selected, setSelected] = useState<SiteFeature | null>(null);
  const [userLngLat, setUserLngLat] = useState<[number, number] | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SitesFeatureCollection>;
      })
      .then((fc) => setSites(fc.features))
      .catch((err: unknown) => {
        console.error("[list] failed to load sites", err);
        setLoadError("Could not load sites. Check your connection.");
      });
  }, []);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setUserLngLat([pos.coords.longitude, pos.coords.latitude]),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8_000 },
    );
  }, []);

  const nearestSafe = useMemo<SiteFeature | null>(() => {
    if (!sites || !userLngLat) return null;
    const [lng, lat] = userLngLat;
    return (
      sites
        .filter((s) => s.properties.status === "pass")
        .sort((a, b) => {
          const [aLng, aLat] = a.geometry.coordinates as [number, number];
          const [bLng, bLat] = b.geometry.coordinates as [number, number];
          return distanceKm(lat, lng, aLat, aLng) - distanceKm(lat, lng, bLat, bLng);
        })[0] ?? null
    );
  }, [sites, userLngLat]);

  const filtered = useMemo<SiteFeature[]>(() => {
    if (!sites) return [];
    const q = search.toLowerCase();
    let result = q ? sites.filter((s) => s.properties.name.toLowerCase().includes(q)) : sites;
    if (sortBy === "status") {
      result = [...result].sort(
        (a, b) =>
          STATUS_SORT_ORDER[a.properties.status as SiteStatus] -
          STATUS_SORT_ORDER[b.properties.status as SiteStatus],
      );
    } else {
      result = [...result].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    }
    return result;
  }, [sites, search, sortBy]);

  return (
    <div className="min-h-screen bg-background text-foreground dark:bg-gray-900">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">All sites</h1>
          <AuthNav />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {nearestSafe && (
          <div
            data-testid="nearest-safe-banner"
            data-site-name={nearestSafe.properties.name}
            className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm dark:bg-teal-900"
          >
            <span className="font-medium text-primary">Nearest safe site: </span>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-primary"
              onClick={() => setSelected(nearestSafe)}
            >
              {nearestSafe.properties.name}
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="search"
            aria-label="Search sites"
            data-testid="list-search"
            placeholder="Search sites…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-800 dark:text-white dark:border-gray-600 dark:placeholder-gray-400"
          />
          <select
            aria-label="Sort by"
            data-testid="list-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "status" | "name")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm dark:bg-gray-800 dark:text-white"
          >
            <option value="status">Sort: Status</option>
            <option value="name">Sort: Name A–Z</option>
          </select>
        </div>

        {sites === null && !loadError && (
          <div data-testid="list-loading" className="space-y-2">
            {[1, 2, 3, 4].map((n) => (
              <SkeletonCard
                key={n}
                lines={2}
                className="rounded-lg border border-border bg-card p-4"
              />
            ))}
          </div>
        )}

        {loadError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {loadError}
          </p>
        )}

        {sites !== null && filtered.length === 0 && (
          <p data-testid="list-empty" className="py-8 text-center text-sm text-muted-foreground">
            No sites match your search.
          </p>
        )}

        <ul data-testid="site-list" className="space-y-2">
          {filtered.map((site) => {
            const isStalePass = site.properties.stale && site.properties.status === "pass";
            const effectiveStatus = isStalePass
              ? "caution"
              : (site.properties.status as SiteStatus);
            const p = STATUS_PRESENTATION[effectiveStatus];
            const Icon = p.icon;
            const badgeLabel = isStalePass ? "Data may be outdated" : p.label.split(" — ")[0];
            return (
              <li key={site.properties.id}>
                <button
                  type="button"
                  data-testid="site-list-item"
                  data-status={site.properties.status}
                  data-site-name={site.properties.name}
                  className="w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 dark:bg-gray-800 dark:border-gray-700"
                  onClick={() => setSelected(site)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{site.properties.name}</span>
                    <span
                      aria-label={`Status: ${isStalePass ? "Data may be outdated" : p.label}`}
                      className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: p.bg, color: p.text, border: `1px solid ${p.border}` }}
                    >
                      <Icon size={12} aria-hidden />
                      {badgeLabel}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      <AppFooter />

      <SiteBottomSheet site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
