import { Beach, BoatRamp, Fishing, Kayak, Marina, SwimArea } from "@/components/icons";
import type { ComponentType, SVGProps } from "react";

export type SiteStatus = "pass" | "caution" | "unsafe" | "no_data";

export type SiteType =
  | "kayak_launch"
  | "boat_ramp"
  | "beach"
  | "swim_area"
  | "fishing_access"
  | "marina";

export type SiteMarkerProps = {
  status: SiteStatus;
  siteType: SiteType;
  stale?: boolean;
  isDark?: boolean;
  onClick?: () => void;
  label?: string;
  pulse?: boolean;
  selected?: boolean;
  personal?: boolean;
};

export const STATUS_COLORS: Record<SiteStatus, { fill: string; border: string; fillDark: string }> =
  {
    pass: { fill: "#3B6D11", border: "#27500A", fillDark: "#4CAF50" },
    caution: { fill: "#BA7517", border: "#854F0B", fillDark: "#FFA726" },
    unsafe: { fill: "#E24B4A", border: "#A32D2D", fillDark: "#EF5350" },
    no_data: { fill: "#888780", border: "#5F5E5A", fillDark: "#A8A7A0" },
  };

export const STATUS_LABEL: Record<SiteStatus, string> = {
  pass: "Pass — no advisory",
  caution: "Caution",
  unsafe: "Unsafe",
  no_data: "No data",
};

export const SITE_TYPE_ICONS: Record<SiteType, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  kayak_launch: Kayak,
  boat_ramp: BoatRamp,
  beach: Beach,
  swim_area: SwimArea,
  fishing_access: Fishing,
  marina: Marina,
};
