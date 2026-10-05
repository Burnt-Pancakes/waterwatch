import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Navigation, Share2 } from "@/components/icons";
import { toast } from "sonner";
import { getSiteDetailsBySlug } from "@/lib/siteDetails.functions";
import { AppFooter } from "@/components/ui/AppFooter";
import {
  StatusBadge,
  StaleBanner,
  RainBanner,
  FavoriteStar,
} from "@/components/map/SiteBottomSheet";
import { AIExplanation } from "@/components/site/AIExplanation";
import { SITE_TYPE_ICONS } from "@/components/map/siteMarkerConstants";
import {
  DISCLAIMERS,
  ECOLI_CAUTION_MAX,
  ECOLI_PASS_THRESHOLD,
  ENTERO_CAUTION_MAX,
  ENTERO_PASS_THRESHOLD,
  getActivityAdvisory,
} from "@/lib/waterQualityEngine";
import { useAuth } from "@/hooks/use-auth";
import type { SiteStatus, SiteType } from "@/components/map/siteMarkerConstants";

export const Route = createFileRoute("/sites/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — WaterWatch DMV` },
      {
        name: "description",
        content: "Water quality status and historical data for this monitoring site.",
      },
      { property: "og:title", content: `${params.slug} — WaterWatch DMV` },
      { property: "og:description", content: "Water quality status and historical data for this monitoring site." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SiteDetailPage,
});

const ACTIVITIES = [
  { id: "swimming", label: "Swimming" },
  { id: "kayaking", label: "Kayaking" },
  { id: "wading", label: "Wading" },
  { id: "fishing", label: "Fishing" },
] as const;

type ActivityId = (typeof ACTIVITIES)[number]["id"];

function SiteDetailPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const authenticated = !!user;
  const [activity, setActivity] = useState<ActivityId | null>(null);

  const fetchDetails = useServerFn(getSiteDetailsBySlug);
  const { data, isLoading } = useQuery({
    queryKey: ["site-by-slug", slug],
    queryFn: () => fetchDetails({ data: { slug } }),
    staleTime: 60_000,
  });

  const onShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: data?.site.name ?? "WaterWatch DMV", url });
        return;
      } catch {
        /* dismissed */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const onDirections = () => {
    if (!data) return;
    const { lat, lng } = data.site;
    const isApple = /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
    const url = isApple
      ? `https://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const waterBodyType = (data?.site.water_body_type ?? "freshwater") as
    | "freshwater"
    | "tidal_brackish";

  const valueLabel =
    waterBodyType === "freshwater" ? "E. coli (MPN/100 mL)" : "Enterococci (CCE/100 mL)";
  const passLine = waterBodyType === "freshwater" ? ECOLI_PASS_THRESHOLD : ENTERO_PASS_THRESHOLD;
  const cautionLine = waterBodyType === "freshwater" ? ECOLI_CAUTION_MAX : ENTERO_CAUTION_MAX;

  const chartData = useMemo(() => {
    if (!data?.readings) return [];
    return [...data.readings]
      .reverse()
      .map((r) => ({
        date: new Date(r.sampled_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        value: waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce,
      }))
      .filter((d) => typeof d.value === "number");
  }, [data, waterBodyType]);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-2/3 rounded-lg bg-muted/50" />
          <div className="h-14 rounded-lg bg-muted/50" />
          <div className="h-24 rounded-lg bg-muted/50" />
          <div className="h-40 rounded-lg bg-muted/50" />
        </div>
      </PageShell>
    );
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <PageShell>
        <div className="py-16 text-center">
          <p className="text-2xl font-semibold">Site not found</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No active monitoring site matches <strong>{slug}</strong>.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to map
          </Link>
        </div>
      </PageShell>
    );
  }

  const { site, latest, status, stale, advisoryActive, geometricMean, readings } = data;
  const TypeIcon = SITE_TYPE_ICONS[site.site_type as SiteType];

  return (
    <PageShell>
      {/* Site name + favourite star */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {TypeIcon && <TypeIcon size={22} className="shrink-0 text-primary" aria-hidden />}
          <h1 className="truncate text-xl font-semibold">{site.name}</h1>
        </div>
        <FavoriteStar siteId={site.id} authenticated={authenticated} />
      </div>

      {/* Banners */}
      <StaleBanner isStale={stale} sampledAt={latest?.sampled_at ?? null} />
      <RainBanner advisoryActive={advisoryActive} />

      {/* Status */}
      <StatusBadge status={status as SiteStatus} />

      {/* Data grid */}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <DataCell
          label="E. coli"
          value={latest?.e_coli_mpn != null ? `${latest.e_coli_mpn} MPN` : "—"}
        />
        <DataCell
          label="Enterococci"
          value={latest?.enterococci_cce != null ? `${latest.enterococci_cce} CCE` : "—"}
        />
        <DataCell
          label="Sampled"
          value={
            latest?.sampled_at
              ? new Date(latest.sampled_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"
          }
        />
        <DataCell label="Source" value={latest?.data_source ?? "—"} />
      </dl>

      {/* Trend chart */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Trend ({valueLabel})</h2>
        {chartData.length < 2 ? (
          <p className="text-sm text-muted-foreground">Not enough historical data yet</p>
        ) : (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip />
                <ReferenceLine
                  y={passLine}
                  stroke="#BA7517"
                  strokeDasharray="4 4"
                  label={{ value: "Caution", position: "right", fontSize: 10 }}
                />
                <ReferenceLine
                  y={cautionLine}
                  stroke="#E24B4A"
                  strokeDasharray="4 4"
                  label={{ value: "Unsafe", position: "right", fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#0d9488"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Geometric mean */}
      {geometricMean && (
        <p className="text-sm">
          <span className="font-semibold">30-day average:</span> {geometricMean.value.toFixed(1)} —{" "}
          {geometricMean.label}
        </p>
      )}

      {/* Recent readings table */}
      {readings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Recent readings</h2>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Value</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {readings.slice(0, 10).map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-2">{new Date(r.sampled_at).toLocaleDateString()}</td>
                  <td className="py-1 pr-2">
                    {(waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce) ?? "—"}
                  </td>
                  <td className="py-1 text-muted-foreground">{r.data_source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Activity advisory */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Activity advisory</h2>
        <div className="flex flex-wrap gap-2">
          {ACTIVITIES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActivity(id)}
              data-testid={`activity-${id}`}
              data-active={activity === id}
              className={[
                "rounded-md border px-3 py-1.5 text-xs font-medium",
                activity === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        {activity && (
          <p
            data-testid="activity-advisory-text"
            className="mt-2 rounded-md bg-muted/60 p-3 text-xs text-foreground/80"
          >
            {getActivityAdvisory(status as SiteStatus, activity)}
          </p>
        )}
      </section>

      {/* AI explanation */}
      <AIExplanation
        siteName={site.name}
        status={status}
        eColiMpn={latest?.e_coli_mpn ?? null}
        enterococciCce={latest?.enterococci_cce ?? null}
        waterBodyType={waterBodyType}
        sampledAt={latest?.sampled_at ?? null}
        dataSource={latest?.data_source ?? null}
        recentRainInches={null}
      />

      {/* Share / Directions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onShare}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <Share2 size={14} aria-hidden /> Share
        </button>
        <button
          type="button"
          onClick={onDirections}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <Navigation size={14} aria-hidden /> Get directions
        </button>
      </div>

      {/* Site metadata */}
      <section className="space-y-1 text-xs text-muted-foreground">
        {site.ada_accessible && (
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
            ADA accessible
          </span>
        )}
        {site.parking_notes && (
          <p>
            <span className="font-medium text-foreground">Parking:</span> {site.parking_notes}
          </p>
        )}
        {site.description && <p className="text-foreground/80">{site.description}</p>}
      </section>

      <p className="text-xs text-muted-foreground">{DISCLAIMERS.siteCard}</p>
      <AppFooter />
    </PageShell>
  );
}

/** Shared page shell: sticky header with back button, scrollable body. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Link
          to="/"
          aria-label="Back to map"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft size={20} />
        </Link>
        <span className="text-base font-semibold text-primary">WaterWatch DMV</span>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
