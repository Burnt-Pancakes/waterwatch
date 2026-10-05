import { useState } from "react";
import { MapPin, Plus, Trash2, X } from "@/components/icons";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { deleteUserSite, type PersonalSite } from "@/lib/userSites.functions";
import { cn } from "@/lib/utils";

type Props = {
  sites: PersonalSite[];
  loading: boolean;
  onClose: () => void;
  onFlyTo: (lngLat: [number, number], siteId: string) => void;
  onEnterPlacement: () => void;
  onRefresh: () => void;
};

export function MySpotsList({
  sites,
  loading,
  onClose,
  onFlyTo,
  onEnterPlacement,
  onRefresh,
}: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const doDelete = useServerFn(deleteUserSite);

  const handleDelete = async (siteId: string) => {
    setDeletingId(siteId);
    try {
      await doDelete({ data: { siteId } });
      toast.success("Spot deleted");
      setConfirmDeleteId(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete spot");
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      data-testid="my-spots-panel"
      className={cn(
        "pointer-events-auto fixed inset-x-4 z-20 flex flex-col",
        "bg-card text-card-foreground shadow-2xl dark:bg-gray-900",
        "rounded-2xl border border-border dark:border-gray-700",
        "bottom-[calc(64px+env(safe-area-inset-bottom)+12px+36px+8px+var(--focus-group-bar-height,0px))]",
        "md:right-auto md:left-4 md:w-[420px]",
      )}
      style={{
        maxHeight: "calc(100dvh - 64px - env(safe-area-inset-bottom) - 12px - 36px - 8px - 16px - var(--focus-group-bar-height, 0px))",
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 dark:border-gray-700">
        <h2 className="text-base font-semibold dark:text-white">My spots</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close my spots"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>}

        {!loading && sites.length === 0 && (
          <div className="px-4 py-8 text-center">
            <MapPin size={32} className="mx-auto mb-2 text-muted-foreground/40" aria-hidden />
            <p className="text-sm text-muted-foreground">No personal spots yet.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use "Add a spot" below to mark a location.
            </p>
          </div>
        )}

        {sites.map((site) => {
          const isConfirming = confirmDeleteId === site.id;
          const isDeleting = deletingId === site.id;

          return (
            <div
              key={site.id}
              data-testid="my-spot-row"
              className="border-b border-border last:border-b-0 dark:border-gray-700/60"
            >
              <div className="flex items-start gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    onFlyTo([site.lng, site.lat], site.id);
                    onClose();
                  }}
                  className="min-w-0 flex-1 text-left"
                  aria-label={`Go to ${site.name} on map`}
                >
                  <p className="truncate text-sm font-medium dark:text-white">{site.name}</p>
                  {site.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {site.description}
                    </p>
                  )}
                </button>

                {!isConfirming && (
                  <button
                    type="button"
                    data-testid="delete-spot-btn"
                    aria-label={`Delete ${site.name}`}
                    onClick={() => setConfirmDeleteId(site.id)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {isConfirming && (
                <div
                  data-testid="delete-confirm"
                  className="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-3 dark:border-gray-700"
                >
                  <p className="text-xs text-foreground">
                    Delete <span className="font-medium">{site.name}</span>? This can't be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted dark:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="confirm-delete-btn"
                      onClick={() => void handleDelete(site.id)}
                      disabled={isDeleting}
                      className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: Add spot action */}
      <div className="shrink-0 border-t border-border px-4 py-3 dark:border-gray-700">
        <button
          type="button"
          data-testid="add-spot-btn"
          onClick={() => {
            onClose();
            onEnterPlacement();
          }}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium",
            "border border-violet-200 bg-violet-50 text-violet-700",
            "hover:bg-violet-100",
            "dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/50",
          )}
        >
          <Plus size={15} aria-hidden />
          Add a spot
        </button>
      </div>
    </div>
  );
}
