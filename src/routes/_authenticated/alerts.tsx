import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Trash2 } from "@/components/icons";
import { toast } from "sonner";
import { listMyAlerts, toggleAlertActive, deleteAlertById } from "@/lib/alerts.functions";
import { formatTriggerOn } from "@/lib/alertTriggers";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV my alerts for DC-area water access and water quality." },
      { property: "og:title", content: "My alerts — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV my alerts for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "My alerts — WaterWatch DMV" }] }),
  component: AlertsPage,
});

function AlertsPage() {
  const queryClient = useQueryClient();
  const fetchAlerts = useServerFn(listMyAlerts);
  const doToggle = useServerFn(toggleAlertActive);
  const doDelete = useServerFn(deleteAlertById);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["my-alerts"],
    queryFn: () => fetchAlerts({ data: undefined }),
    staleTime: 30_000,
  });

  const handleToggle = async (alertId: string, next: boolean) => {
    try {
      await doToggle({ data: { alertId, isActive: next } });
      void queryClient.invalidateQueries({ queryKey: ["my-alerts"] });
    } catch {
      toast.error("Could not update alert");
    }
  };

  const handleDelete = async (alertId: string, siteName: string) => {
    try {
      await doDelete({ data: { alertId } });
      void queryClient.invalidateQueries({ queryKey: ["my-alerts"] });
      toast.success(`Removed alert for ${siteName}`);
    } catch {
      toast.error("Could not delete alert");
    }
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Bell size={22} className="text-primary" />
          <h1 className="text-2xl font-semibold">My alerts</h1>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-20 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        )}

        {!isLoading && (!alerts || alerts.length === 0) && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Bell size={40} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No alerts set yet. Tap the bell icon on any site to get notified when conditions
              change.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Explore the map
            </Link>
          </div>
        )}

        {!isLoading && alerts && alerts.length > 0 && (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {a.siteSlug ? (
                      <Link
                        to="/sites/$slug"
                        params={{ slug: a.siteSlug }}
                        className="block truncate font-semibold hover:text-primary"
                      >
                        {a.siteName}
                      </Link>
                    ) : (
                      <p className="truncate font-semibold">{a.siteName}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.triggerOn.length > 0
                        ? formatTriggerOn(a.triggerOn)
                        : "No triggers selected"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={a.isActive ? "Pause alert" : "Resume alert"}
                      onClick={() => handleToggle(a.id, !a.isActive)}
                      className={`rounded-full p-1.5 transition-colors hover:bg-muted ${
                        a.isActive ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {a.isActive ? <Bell size={18} /> : <BellOff size={18} />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete alert for ${a.siteName}`}
                      onClick={() => handleDelete(a.id, a.siteName)}
                      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
