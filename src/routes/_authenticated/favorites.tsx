import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "@/components/icons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFavoritesWithStatus, removeFavorite } from "@/lib/favorites.functions";
import { AlertBell } from "@/components/favorites/AlertConfigModal";
import { STATUS_PRESENTATION } from "@/components/map/statusPresentation";
import type { SiteStatus } from "@/components/map/siteMarkerConstants";

export const Route = createFileRoute("/_authenticated/favorites")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV favorites for DC-area water access and water quality." },
      { property: "og:title", content: "Favorites — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV favorites for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Favorites — WaterWatch DMV" }] }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const queryClient = useQueryClient();
  const fetchFavorites = useServerFn(getFavoritesWithStatus);
  const doRemove = useServerFn(removeFavorite);

  const { data: favorites, isLoading } = useQuery({
    queryKey: ["favorites"],
    queryFn: () => fetchFavorites({ data: undefined }),
    staleTime: 60_000,
  });

  // Realtime: invalidate favorites cache on any new reading.
  useEffect(() => {
    const channel = supabase
      .channel("favorites-readings")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "readings" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["favorites"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const handleRemove = async (favoriteId: string, siteName: string) => {
    try {
      await doRemove({ data: { favoriteId } });
      void queryClient.invalidateQueries({ queryKey: ["favorites"] });
      toast.success(`Removed ${siteName} from favorites`);
    } catch {
      toast.error("Could not remove favorite");
    }
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Star size={22} className="text-primary" fill="currentColor" />
          <h1 className="text-2xl font-semibold">Favorites</h1>
        </div>

        {isLoading && (
          <div data-testid="favorites-loading" className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-20 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        )}

        {!isLoading && (!favorites || favorites.length === 0) && (
          <div
            data-testid="favorites-empty"
            className="rounded-lg border border-border bg-card p-8 text-center"
          >
            <Star size={40} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No favorites yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap the star on any site to save it here.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Explore the map
            </Link>
          </div>
        )}

        {!isLoading && favorites && favorites.length > 0 && (
          <ul data-testid="favorites-list" className="space-y-3">
            {favorites.map((fav) => {
              const isStalePass = fav.stale && fav.status === "pass";
              const effectiveStatus = isStalePass ? "caution" : (fav.status as SiteStatus);
              const p = STATUS_PRESENTATION[effectiveStatus];
              const Icon = p.icon;
              const label = isStalePass ? "Data may be outdated" : p.label;

              const subtext =
                fav.stale && fav.status !== "no_data" && fav.sampledAt
                  ? fav.status === "unsafe"
                    ? `Sampled ${new Date(fav.sampledAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })} — conditions may have changed`
                    : `Sampled ${new Date(fav.sampledAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })} — verify before entering water`
                  : null;

              return (
                <li
                  key={fav.favoriteId}
                  data-testid="favorite-card"
                  data-status={fav.status}
                  className="rounded-lg border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to="/sites/$slug"
                        params={{ slug: fav.siteSlug }}
                        className="block truncate font-semibold hover:text-primary"
                      >
                        {fav.siteName}
                      </Link>
                      {fav.sampledAt && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Sampled{" "}
                          {new Date(fav.sampledAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          {fav.stale && " (stale)"}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <AlertBell siteId={fav.siteId} siteName={fav.siteName} />
                      <button
                        type="button"
                        aria-label={`Remove ${fav.siteName} from favorites`}
                        data-testid="remove-favorite-btn"
                        onClick={() => handleRemove(fav.favoriteId, fav.siteName)}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
                    style={{
                      background: p.bg,
                      border: `1px solid ${p.border}`,
                      color: p.text,
                    }}
                  >
                    <Icon size={16} aria-hidden />
                    <span>{label}</span>
                  </div>
                  {subtext && <p className="mt-1.5 text-xs text-muted-foreground">{subtext}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
