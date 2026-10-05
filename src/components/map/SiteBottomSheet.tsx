import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Bell,
  Clock,
  CloudRain,
  Fish,
  Pencil,
  Kayak,
  MapPin,
  Navigation,
  Share2,
  Star,
  Trash2,
  SwimArea,
  X,
} from "@/components/icons";
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
import { useServerFn } from "@tanstack/react-start";
import { updateUserSite, deleteUserSite } from "@/lib/userSites.functions";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getSiteDetails } from "@/lib/siteDetails.functions";
import {
  DISCLAIMERS,
  ECOLI_CAUTION_MAX,
  ECOLI_PASS_THRESHOLD,
  ENTERO_CAUTION_MAX,
  ENTERO_PASS_THRESHOLD,
  STALE_THRESHOLD_DAYS,
  getActivityAdvisory,
  shouldShowRecentRainAdvisory,
} from "@/lib/waterQualityEngine";
import { AlertConfigModal } from "@/components/favorites/AlertConfigModal";
import { getAlertConfig } from "@/lib/alerts.functions";
import { GuestAlertForm } from "@/components/site/GuestAlertForm";
import { AIExplanation } from "@/components/site/AIExplanation";
import { RiverStage } from "@/components/site/RiverStage";
import { WeatherCard } from "@/components/site/WeatherCard";
import { TideStrip } from "@/components/site/TideStrip";
import { CollapsibleCard } from "@/components/site/CollapsibleCard";
import { WaterTempBanner } from "@/modules/waterTemp";
import { SITE_TYPE_ICONS } from "./siteMarkerConstants";
import type { SiteStatus, SiteType } from "./siteMarkerConstants";
import { STATUS_PRESENTATION } from "./statusPresentation";
import type { SiteFeature } from "./types";

type SiteBottomSheetProps = {
  site: SiteFeature | null;
  onClose: () => void;
  onSiteDeleted?: () => void;
  onSiteUpdated?: () => void;
  /** IDs of sites owned by the current user. Used to show the delete/rename
   * controls without relying on owner_id being present in the GeoJSON
   * properties (the RPC omits that column). */
  personalSiteIds?: Set<string>;
};

export function StatusBadge({ status }: { status: SiteStatus }) {
  const p = STATUS_PRESENTATION[status];
  const Icon = p.icon;

  // Entrance animation: fade in on mount
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div
      data-testid="status-badge"
      data-status={status}
      role="status"
      aria-label={`Water quality status: ${p.label}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-4 py-3 font-medium transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.text }}
    >
      <Icon size={22} aria-hidden />
      <span className="truncate">{p.label}</span>
    </div>
  );
}

/* ------------------------------- Stale / Rain banners ------------------------- */

export function StaleBanner({
  isStale,
  sampledAt,
}: {
  isStale: boolean;
  sampledAt: string | null;
}) {
  if (!isStale || !sampledAt) return null;
  const days = Math.max(
    STALE_THRESHOLD_DAYS,
    Math.floor((Date.now() - Date.parse(sampledAt)) / (24 * 60 * 60 * 1000)),
  );
  return (
    <div
      data-testid="stale-banner"
      aria-live="polite"
      className="flex items-start gap-2 rounded-r-md px-3 py-2 text-sm dark:bg-blue-950 dark:border-blue-400 dark:text-blue-200"
      style={{
        background: "#E6F1FB",
        borderLeft: "3px solid #185FA5",
        color: "#0E3A66",
      }}
    >
      <Clock size={16} color="#185FA5" className="mt-0.5 shrink-0" aria-hidden />
      <p>{DISCLAIMERS.staleData.replace("{days}", String(days))}</p>
    </div>
  );
}

export function RainBanner({ advisoryActive }: { advisoryActive: boolean }) {
  if (!advisoryActive) return null;
  return (
    <div
      data-testid="rain-banner"
      aria-live="polite"
      className="flex items-start gap-2 rounded-r-md px-3 py-2 text-sm dark:bg-amber-950 dark:border-amber-400 dark:text-amber-200"
      style={{
        background: "#FAEEDA",
        borderLeft: "3px solid #BA7517",
        color: "#633806",
      }}
    >
      <CloudRain size={16} color="#BA7517" className="mt-0.5 shrink-0" aria-hidden />
      <p>{DISCLAIMERS.rainAdvisory}</p>
    </div>
  );
}

export function RecentRainfallBanner({
  precipInches24h,
  isTidal,
}: {
  precipInches24h: number | null;
  isTidal: boolean;
}) {
  if (precipInches24h === null || !shouldShowRecentRainAdvisory(precipInches24h, isTidal)) {
    return null;
  }
  const display = precipInches24h.toFixed(2);
  return (
    <div
      data-testid="recent-rainfall-banner"
      aria-live="polite"
      className="flex items-start gap-2 rounded-r-md px-3 py-2 text-sm dark:bg-amber-950 dark:border-amber-400 dark:text-amber-200"
      style={{
        background: "#FAEEDA",
        borderLeft: "3px solid #BA7517",
        color: "#633806",
      }}
    >
      <CloudRain size={16} color="#BA7517" className="mt-0.5 shrink-0" aria-hidden />
      <p>{DISCLAIMERS.recentRainAdvisory.replace("{inches}", display)}</p>
    </div>
  );
}

/* --------------------------------- Favorite star ------------------------------ */

export function FavoriteStar({
  siteId,
  authenticated,
}: {
  siteId: string;
  authenticated: boolean;
}) {
  const [showTip, setShowTip] = useState(false);
  const [starred, setStarred] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Bounce animation state (Task 3a)
  const [bouncing, setBouncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authenticated) {
      setStarred(false);
      setLoaded(true);
      return;
    }
    let active = true;
    void supabase
      .from("favorites")
      .select("id")
      .eq("site_id", siteId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setStarred(!!data);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [siteId, authenticated]);

  const onClick = useCallback(async () => {
    // Trigger bounce animation for 200ms
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 200);

    if (!authenticated) {
      setShowTip(true);
      window.setTimeout(() => setShowTip(false), 2200);
      return;
    }
    const next = !starred;
    setStarred(next); // optimistic
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setStarred(!next);
      return;
    }
    if (next) {
      const { error } = await supabase
        .from("favorites")
        .insert({ site_id: siteId, user_id: user.id });
      if (error) {
        setStarred(false);
        toast.error("Could not save favorite");
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("site_id", siteId)
        .eq("user_id", user.id);
      if (error) {
        setStarred(true);
        toast.error("Could not remove favorite");
      }
    }
  }, [authenticated, siteId, starred]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={starred ? "Remove from favorites" : "Save to favorites"}
        aria-pressed={starred}
        data-testid="favorite-star"
        data-starred={starred}
        data-loaded={loaded}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full transition-colors transition-transform duration-200 hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600",
          bouncing ? "scale-110" : "scale-100",
        )}
      >
        <Star
          size={18}
          color={starred ? "#0d9488" : "#9CA3AF"}
          fill={starred ? "#14b8a6" : "none"}
          strokeWidth={2}
        />
      </button>
      {showTip && (
        <div
          role="tooltip"
          data-testid="favorite-signin-tooltip"
          className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md"
        >
          Sign in to save favorites
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- Sheet ----------------------------------- */

const ACTIVITIES = [
  { id: "swimming", label: "Swimming", Icon: SwimArea },
  { id: "kayaking", label: "Kayaking", Icon: Kayak },
  { id: "wading", label: "Wading", Icon: MapPin },
  { id: "fishing", label: "Fishing", Icon: Fish },
] as const;

type ActivityId = (typeof ACTIVITIES)[number]["id"];

export function SiteBottomSheet({
  site,
  onClose,
  onSiteDeleted,
  onSiteUpdated,
  personalSiteIds,
}: SiteBottomSheetProps) {
  const open = site !== null;
  const [activity, setActivity] = useState<ActivityId | null>(null);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [hasAlert, setHasAlert] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const authenticated = !!user;
  // personalSiteIds comes from WaterVoiceMap (listUserSites result) and is the
  // reliable ownership signal — the RPC omits owner_id from its RETURNS TABLE.
  const isOwner =
    !!user &&
    !!(personalSiteIds
      ? personalSiteIds.has(site?.properties.id ?? "")
      : site?.properties.owner_id === user.id);

  const doUpdate = useServerFn(updateUserSite);
  const doDelete = useServerFn(deleteUserSite);

  // Reset transient UI whenever the selected site changes.
  useEffect(() => {
    setActivity(null);
    setRenaming(false);
    setRenameValue("");
    setConfirmDelete(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [site?.properties.id]);

  const fetchDetails = useServerFn(getSiteDetails);
  const fetchAlertConfig = useServerFn(getAlertConfig);

  // Reflect saved alert state on the header bell.
  useEffect(() => {
    const siteId = site?.properties.id;
    if (!siteId || !authenticated) {
      setHasAlert(false);
      return;
    }
    let active = true;
    void fetchAlertConfig({ data: { siteId } })
      .then((config) => {
        if (active) setHasAlert(!!config && config.is_active !== false);
      })
      .catch(() => {
        if (active) setHasAlert(false);
      });
    return () => {
      active = false;
    };
  }, [site?.properties.id, authenticated, fetchAlertConfig]);

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ["site-details", site?.properties.id ?? null],
    queryFn: () => fetchDetails({ data: { siteId: site!.properties.id } }),
    enabled: !!site,
    staleTime: 60_000,
  });

  /* Drag-to-dismiss / drag-to-expand (touch only). */
  const dragStartY = useRef<number | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (dy > 80) {
      onClose();
    }
  };

  const status: SiteStatus =
    (details?.status as SiteStatus | undefined) ?? site?.properties.status ?? "no_data";

  const isStale = details?.stale ?? site?.properties.stale ?? false;
  const sampledAt = details?.latest?.sampled_at ?? site?.properties.sampled_at ?? null;
  const advisoryActive = details?.advisoryActive ?? false;

  const waterBodyType = site?.properties.water_body_type ?? "freshwater";
  const valueLabel =
    waterBodyType === "freshwater" ? "E. coli (MPN/100 mL)" : "Enterococci (CCE/100 mL)";
  const passLine = waterBodyType === "freshwater" ? ECOLI_PASS_THRESHOLD : ENTERO_PASS_THRESHOLD;
  const cautionLine = waterBodyType === "freshwater" ? ECOLI_CAUTION_MAX : ENTERO_CAUTION_MAX;

  const chartData = useMemo(() => {
    if (!details?.readings) return [];
    return [...details.readings]
      .reverse()
      .map((r) => ({
        date: new Date(r.sampled_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        value: waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce,
      }))
      .filter((d) => typeof d.value === "number");
  }, [details, waterBodyType]);

  const TypeIcon = site ? SITE_TYPE_ICONS[site.properties.site_type as SiteType] : undefined;

  const onShare = async () => {
    if (typeof window === "undefined" || !site) return;
    const url = `${window.location.origin}/sites/${site.properties.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: site.properties.name, url });
        return;
      } catch {
        /* user dismissed share sheet */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const handleRenameSubmit = async () => {
    if (!site || !renameValue.trim()) return;
    setRenameSaving(true);
    try {
      await doUpdate({ data: { siteId: site.properties.id, name: renameValue.trim() } });
      toast.success("Spot renamed");
      setRenaming(false);
      onSiteUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename spot");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!site) return;
    setDeleting(true);
    try {
      await doDelete({ data: { siteId: site.properties.id } });
      toast.success("Spot deleted");
      onSiteDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete spot");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const onDirections = () => {
    if (typeof window === "undefined" || !site) return;
    const [lng, lat] = site.geometry.coordinates;
    const isApple = /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
    const url = isApple
      ? `https://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      data-testid="site-bottom-sheet"
      data-open={open}
      role="dialog"
      aria-hidden={!open}
      className={cn(
        "pointer-events-auto fixed z-20 bg-card text-card-foreground shadow-2xl dark:bg-gray-900",
        // Floating panel anchored just above the search pill on all viewports.
        // Pill sits at bottom = 64 (nav) + safe-area + 12 (gap). Add pill height (36) + 8 gap.
        "left-4 right-4 rounded-2xl border border-border dark:border-gray-700",
        "bottom-[calc(64px+env(safe-area-inset-bottom)+12px+36px+8px+var(--focus-group-bar-height,0px))]",
        // Desktop: keep it left-aligned with a constrained width and taller default.
        "md:right-auto md:w-[420px]",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        open ? "translate-y-0" : "translate-y-[calc(100%+96px)]",
      )}
      style={{
        // Height stays constant; expanded details fade in without resizing the panel.
        // Mobile: ~45dvh so the map and selected pin remain visible above the panel.
        height: open
          ? typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
            ? "75dvh"
            : "45dvh"
          : undefined,
        maxHeight:
          typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
            ? "75dvh"
            : "45dvh",
      }}
    >
      {site && (
        <div ref={scrollRef} className="flex h-full flex-col overflow-y-auto rounded-2xl pb-4">
          {/* Sticky header (includes drag handle on mobile) */}
          <div className="sticky top-0 z-10 bg-card px-4 md:pt-4">
            {/* Drag handle (mobile only) */}
            <div
              data-testid="sheet-drag-handle"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              className="flex shrink-0 items-center justify-center py-2 md:hidden"
            >
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
            </div>

            <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 pb-2 pt-1">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {TypeIcon && <TypeIcon size={20} className="shrink-0 text-primary" aria-hidden />}
                {renaming ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRenameSubmit();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    maxLength={120}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-lg font-semibold focus:border-teal-500 focus:outline-none dark:bg-gray-800 dark:text-white"
                  />
                ) : (
                  <h2 className="min-w-0 truncate text-lg font-semibold leading-tight dark:text-white">
                    {site.properties.name}
                  </h2>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {isOwner && !renaming && (
                  <button
                    type="button"
                    aria-label="Rename spot"
                    onClick={() => {
                      setRenameValue(site.properties.name);
                      setRenaming(true);
                    }}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {isOwner && renaming && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRenameSubmit()}
                      disabled={!renameValue.trim() || renameSaving}
                      className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {renameSaving ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </>
                )}
                <FavoriteStar siteId={site.properties.id} authenticated={authenticated} />
                {authenticated && (
                  <button
                    type="button"
                    onClick={() => setAlertModalOpen(true)}
                    aria-label={hasAlert ? "Edit alert" : "Set alert"}
                    aria-pressed={hasAlert}
                    data-testid="set-alert-button"
                    data-alert-on={hasAlert}
                    className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
                  >
                    <Bell
                      size={18}
                      color={hasAlert ? "#0d9488" : "#9CA3AF"}
                      fill={hasAlert ? "#14b8a6" : "none"}
                      strokeWidth={2}
                    />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-2 pb-6">
            <RainBanner advisoryActive={advisoryActive} />
            <RecentRainfallBanner
              precipInches24h={details?.precipInches24h ?? null}
              isTidal={waterBodyType === "tidal_brackish"}
            />

            {/* Main status — always shown using already-loaded map data */}
            <StatusBadge status={status} />

            {status === "no_data" ? (
              <NoDataPanel
                siteType={site.properties.site_type as SiteType}
                address={
                  (details?.site?.address as string | null | undefined) ??
                  site.properties.address ??
                  null
                }
              />
            ) : (
              <>
                {/* Data rows */}
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <DataCell
                    label="E. coli"
                    value={
                      !detailsLoading && details?.latest?.e_coli_mpn != null
                        ? `${details.latest.e_coli_mpn} MPN`
                        : "—"
                    }
                  />
                  <DataCell
                    label="Enterococci"
                    value={
                      !detailsLoading && details?.latest?.enterococci_cce != null
                        ? `${details.latest.enterococci_cce} CCE`
                        : "—"
                    }
                  />
                  <DataCell
                    label="Sampled"
                    value={
                      sampledAt
                        ? new Date(sampledAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"
                    }
                    stale={isStale}
                    staleDays={
                      isStale && sampledAt
                        ? Math.max(
                            1,
                            Math.floor(
                              (Date.now() - Date.parse(sampledAt)) / (24 * 60 * 60 * 1000),
                            ),
                          )
                        : null
                    }
                  />
                  <DataCell
                    label="Source"
                    value={!detailsLoading ? (details?.latest?.data_source ?? "—") : "—"}
                  />
                </dl>

                {/* Safety verdict context: trend + 30-day average */}
                {detailsLoading ? (
                  <CollapsibleCard testId="trend-chart" title={`Trend (${valueLabel})`} loading>
                    <div />
                  </CollapsibleCard>
                ) : chartData.length >= 2 ? (
                  <CollapsibleCard testId="trend-chart" title={`Trend (${valueLabel})`}>
                    <div className="h-40 w-full">
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
                            stroke="#0d9486"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CollapsibleCard>
                ) : null}

                {!detailsLoading && details?.geometricMean && (
                  <section data-testid="geomean">
                    <p className="text-sm">
                      <span className="font-semibold">30-day average:</span>{" "}
                      {details.geometricMean.value.toFixed(1)} — {details.geometricMean.label}
                    </p>
                  </section>
                )}
              </>
            )}

            <div data-testid="sheet-sections" className="space-y-3">
              {/* Recent readings table */}
              {detailsLoading && (
                <CollapsibleCard testId="recent-readings-card" title="Recent readings" loading>
                  <div />
                </CollapsibleCard>
              )}
              {!detailsLoading && details?.readings && details.readings.length > 0 && (
                <CollapsibleCard
                  testId="recent-readings-card"
                  title="Recent readings"
                  summary={
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
                      {details.readings.length}
                    </span>
                  }
                >
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 pr-2 font-medium">Date</th>
                        <th className="py-1 pr-2 font-medium">Value</th>
                        <th className="py-1 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.readings.slice(0, 10).map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="py-1 pr-2">
                            {new Date(r.sampled_at).toLocaleDateString()}
                          </td>
                          <td className="py-1 pr-2">
                            {(waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce) ??
                              "—"}
                          </td>
                          <td className="py-1 text-muted-foreground">{r.data_source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CollapsibleCard>
              )}

              <WaterTempBanner
                lat={site.geometry.coordinates[1]}
                lng={site.geometry.coordinates[0]}
              />

              {/* River stage (between status/data and activity advisory) */}
              <RiverStage siteId={site.properties.id} />

              <TideStrip siteId={site.properties.id} />

              <WeatherCard />

              {/* Activity advisory */}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Activity advisory</h3>
                <div className="flex flex-wrap gap-2">
                  {ACTIVITIES.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActivity(id)}
                      data-testid={`activity-${id}`}
                      data-active={activity === id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium",
                        activity === id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:bg-muted",
                      )}
                    >
                      <Icon size={14} aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
                {activity && (
                  <p
                    data-testid="activity-advisory-text"
                    className="mt-2 rounded-md bg-muted/60 p-3 text-xs text-foreground/80"
                  >
                    {getActivityAdvisory(status, activity)}
                  </p>
                )}
              </section>

              {/* AI / Share / Directions */}
              <AIExplanation
                siteName={site.properties.name}
                status={status}
                eColiMpn={details?.latest?.e_coli_mpn ?? null}
                enterococciCce={details?.latest?.enterococci_cce ?? null}
                waterBodyType={waterBodyType as "freshwater" | "tidal_brackish"}
                sampledAt={sampledAt}
                dataSource={details?.latest?.data_source ?? null}
                recentRainInches={details?.precipInches24h ?? null}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onShare}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  <Share2 size={14} /> Share
                </button>
                <button
                  type="button"
                  onClick={onDirections}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  <Navigation size={14} /> Get directions
                </button>
              </div>

              {/* Metadata */}
              <section className="space-y-1 text-xs text-muted-foreground">
                {details?.site?.ada_accessible && (
                  <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    ADA accessible
                  </span>
                )}
                {details?.site?.parking_notes && (
                  <p>
                    <span className="font-medium text-foreground">Parking:</span>{" "}
                    {details.site.parking_notes}
                  </p>
                )}
                {details?.site?.description && (
                  <p className="text-foreground/80">{details.site.description}</p>
                )}
              </section>
            </div>

            {!authenticated && site && (
              <GuestAlertForm siteId={site.properties.id} siteName={site.properties.name} />
            )}

            <p className="text-xs text-muted-foreground">{DISCLAIMERS.siteCard}</p>

            {/* Owner-only: delete this spot */}
            {isOwner && (
              <div className="border-t border-border pt-3 dark:border-gray-700">
                {!confirmDelete ? (
                  <button
                    type="button"
                    data-testid="delete-site-button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={13} aria-hidden />
                    Delete this spot
                  </button>
                ) : (
                  <div data-testid="delete-site-confirm" className="flex flex-col gap-2">
                    <p className="text-xs text-foreground">
                      Delete this spot? This can&apos;t be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted dark:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="confirm-delete-site-btn"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                        className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {site && authenticated && alertModalOpen && (
        <AlertConfigModal
          siteId={site.properties.id}
          siteName={site.properties.name}
          open={alertModalOpen}
          onClose={() => setAlertModalOpen(false)}
          onChanged={(active) => setHasAlert(active)}
        />
      )}
    </div>
  );
}

function DataCell({
  label,
  value,
  stale = false,
  staleDays = null,
}: {
  label: string;
  value: string;
  stale?: boolean;
  staleDays?: number | null;
}) {
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2",
        stale
          ? "border border-yellow-200 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30"
          : "bg-muted/40 dark:border-gray-700",
      )}
    >
      <dt className="text-xs text-muted-foreground dark:text-gray-400">{label}</dt>
      <dd
        className={cn(
          "font-medium dark:text-gray-200",
          stale && "text-yellow-800 dark:text-yellow-200",
        )}
      >
        {value}
      </dd>
      {stale && typeof staleDays === "number" && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-yellow-700 dark:text-yellow-300">
          <Clock size={11} aria-hidden />
          {staleDays} days ago
          <span className="italic">Water conditions change quickly.</span>
        </p>
      )}
    </div>
  );
}

function NoDataPanel({ siteType, address }: { siteType: SiteType; address: string | null }) {
  const Icon = SITE_TYPE_ICONS[siteType];
  const typeLabel = siteType
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
  return (
    <div
      data-testid="no-data-panel"
      className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{ background: "#F3F4F6", borderColor: "#D1D5DB", color: "#374151" }}
    >
      <Icon size={20} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{typeLabel}</p>
        {address && <p className="text-xs text-muted-foreground">{address}</p>}
        <p>No water quality data available yet</p>
      </div>
    </div>
  );
}
