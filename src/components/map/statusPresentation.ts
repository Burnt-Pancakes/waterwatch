import { Warning, Pass, NoData, Fail, type LucideIcon } from "@/components/icons";

import type { SiteStatus } from "./siteMarkerConstants";

export const STATUS_PRESENTATION: Record<
  SiteStatus,
  {
    label: string;
    bg: string;
    border: string;
    text: string;
    icon: LucideIcon;
  }
> = {
  pass: {
    label: "Pass — no advisory in effect",
    bg: "#EAF3DE",
    border: "#3B6D11",
    text: "#27500A",
    icon: Pass,
  },
  caution: {
    label: "Caution — advisory possible",
    bg: "#FAEEDA",
    border: "#BA7517",
    text: "#633806",
    icon: Warning,
  },
  unsafe: {
    label: "Fail — advisory in effect",
    bg: "#FCEBEB",
    border: "#E24B4A",
    text: "#791F1F",
    icon: Fail,
  },
  no_data: {
    label: "No recent data",
    bg: "#F1EFE8",
    border: "#888780",
    text: "#444441",
    icon: NoData,
  },
};
