import { WarningIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, STATUS_LABEL, SITE_TYPE_ICONS } from "./siteMarkerConstants";

export type { SiteStatus, SiteType, SiteMarkerProps } from "./siteMarkerConstants";

import type { SiteMarkerProps } from "./siteMarkerConstants";

/**
 * Visual marker for a single site. Rendered inside a MapLibre `Marker`
 * (which only needs an `HTMLElement`) — keeping it as React lets us reuse
 * Lucide icons and Tailwind tokens.
 */
export function SiteMarker({
  status,
  siteType,
  stale,
  isDark,
  onClick,
  label,
  pulse,
  selected,
  personal,
}: SiteMarkerProps) {
  const Icon = SITE_TYPE_ICONS[siteType];
  const colors = STATUS_COLORS[status];
  const fill = isDark && status !== "no_data" ? colors.fillDark : colors.fill;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ? `${label}: ${STATUS_LABEL[status]}` : `Site: ${STATUS_LABEL[status]}`}
      data-testid="site-marker"
      data-site-type={siteType}
      data-status={status}
      data-stale={stale ?? false}
      data-selected={selected ?? false}
      className={cn(
        "relative grid min-h-[44px] min-w-[44px] place-items-center rounded-full shadow-md transition-transform",
        "cursor-pointer hover:scale-105 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600",
        selected &&
          "z-10 scale-125 shadow-xl ring-4 ring-teal-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900",
      )}
      style={{
        backgroundColor: fill,
        border: `2px solid ${colors.border}`,
      }}
    >
      <Icon size={16} color="#ffffff" strokeWidth={2.25} />
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-teal-500 shadow-md"
        />
      )}
      {stale && (
        <span
          data-testid="stale-overlay"
          aria-hidden
          title="Reading is more than 7 days old"
          className="absolute -right-1.5 -top-1.5 drop-shadow-sm"
        >
          <WarningIcon size={16} strokeWidth={2} strokeColor="#FFFFFF" />
        </span>
      )}
      {personal && (
        <span
          data-testid="personal-site-glyph"
          aria-hidden
          className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white"
          style={{ backgroundColor: "#7c3aed" }}
        />
      )}
      {pulse && (
        <span
          aria-hidden
          className="watervoice-marker-pulse pointer-events-none absolute inset-0 rounded-full"
        />
      )}
    </button>
  );
}
