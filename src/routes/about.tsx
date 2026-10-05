import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, CheckCircle, MapPin } from "@/components/icons";
import { AppFooter } from "@/components/ui/AppFooter";
import { DISCLAIMERS } from "@/lib/waterQualityEngine";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { property: "og:title", content: "About — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV about for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "About — WaterWatch DMV" },
      {
        name: "description",
        content:
          "Learn how WaterWatch DMV provides plain-language water quality advisories for the DC Metro area.",
      },
    ],
  }),
  component: AboutPage,
});

/** Status display item for the Status System section. */
type StatusItem = {
  label: string;
  description: string;
  color: string;
  bg: string;
  border: string;
};

const STATUS_ITEMS: StatusItem[] = [
  {
    label: "PASS",
    description: "E. coli ≤ 235 MPN/100mL (freshwater) or Enterococci ≤ 35 CCE/100mL (tidal)",
    color: "#3B6D11",
    bg: "#EAF3DE",
    border: "#3B6D11",
  },
  {
    label: "CAUTION",
    description: "Elevated bacteria detected — use caution, especially after rain",
    color: "#BA7517",
    bg: "#FAEEDA",
    border: "#BA7517",
  },
  {
    label: "UNSAFE",
    description: "Bacteria exceed EPA 2012 RWQC thresholds — avoid water contact",
    color: "#E24B4A",
    bg: "#FCEBEB",
    border: "#E24B4A",
  },
  {
    label: "NO DATA",
    description: "No recent sampling data available for this site",
    color: "#888780",
    bg: "#F1EFE8",
    border: "#888780",
  },
];

const OVERLAY_ITEMS = [
  {
    label: "STALE",
    description: "Reading is more than 7 days old — conditions may have changed",
    bg: "#FEFCE8",
    border: "#EAB308",
    color: "#854D0E",
  },
  {
    label: "RAIN ADVISORY",
    description: "Heavy rainfall in the past 48 hours may have elevated bacteria levels",
    bg: "#FAEEDA",
    border: "#BA7517",
    color: "#633806",
  },
];

const HOW_IT_WORKS = [
  {
    Icon: Activity,
    title: "We monitor",
    description:
      "Data from USGS, Arlington County, and other public sources is collected and updated continuously.",
  },
  {
    Icon: CheckCircle,
    title: "We decide",
    description:
      "EPA 2012 Recreational Water Quality Criteria thresholds are applied to determine if water is safe for recreation.",
  },
  {
    Icon: MapPin,
    title: "You know",
    description:
      "Open the map, tap any site, and see its status instantly — no science degree required.",
  },
];

const DATA_SOURCES = [
  { name: "USGS Water Quality Portal", url: "https://www.waterqualitydata.us/" },
  { name: "Arlington County DES", url: "https://www.arlingtonva.us/Government/Departments/DES" },
  { name: "NOAA Weather API", url: "https://www.weather.gov/documentation/services-web-api" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
];

function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link to="/" className="text-base font-bold text-primary">
            WaterWatch DMV
          </Link>
          <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            ← Back to map
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-8">
        {/* Hero */}
        <section className="py-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            WaterWatch DMV
          </h1>
          <p className="mt-3 text-lg font-medium text-primary">
            Real-time water quality for DC Metro recreational sites
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            WaterWatch DMV checks public water quality data from monitoring stations across the DC
            Metro area and tells you whether it is safe to swim, paddle, or kayak today.
          </p>
        </section>

        {/* How It Works */}
        <section className="space-y-4 border-t border-border pt-8 dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">How It Works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map(({ Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Icon size={20} className="text-primary" aria-hidden />
                </div>
                <h3 className="mb-1 text-sm font-semibold dark:text-white">{title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground dark:text-gray-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Status System */}
        <section className="space-y-4 border-t border-border pt-8 dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">Status System</h2>
          <p className="text-sm text-muted-foreground dark:text-gray-400">
            Every site shows one of four statuses, computed directly from EPA 2012 Recreational
            Water Quality Criteria.
          </p>
          <div className="space-y-2">
            {STATUS_ITEMS.map((item) => (
              <div
                key={item.label}
                data-testid={`status-item-${item.label}`}
                className="flex items-start gap-3 rounded-lg border px-4 py-3"
                style={{ background: item.bg, border: `1px solid ${item.border}` }}
              >
                <span
                  className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold"
                  style={{ color: item.color, background: item.bg }}
                >
                  {item.label}
                </span>
                <p className="text-xs leading-relaxed" style={{ color: item.color }}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <h3 className="pt-2 text-sm font-semibold dark:text-white">Overlay indicators</h3>
          <div className="space-y-2">
            {OVERLAY_ITEMS.map((item) => (
              <div
                key={item.label}
                className="flex items-start gap-3 rounded-lg border px-4 py-3"
                style={{
                  background: item.bg,
                  borderLeft: `3px solid ${item.border}`,
                  color: item.color,
                }}
              >
                <span className="shrink-0 text-xs font-bold">{item.label}</span>
                <p className="text-xs leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data Sources */}
        <section className="space-y-4 border-t border-border pt-8 dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">Data Sources</h2>
          <p className="text-sm text-muted-foreground dark:text-gray-400">
            WaterWatch DMV does not generate its own measurements. We aggregate publicly available
            water quality data from:
          </p>
          <ul className="space-y-2">
            {DATA_SOURCES.map(({ name, url }) => (
              <li key={name} className="flex items-center gap-2 text-sm">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:text-primary/80"
                >
                  {name}
                </a>
              </li>
            ))}
          </ul>
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            {DISCLAIMERS.footer}
          </p>
        </section>

        {/* About the Project */}
        <section className="space-y-4 border-t border-border pt-8 dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">About the Project</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Built by{" "}
            <a
              href="https://civictechdc.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              CivicTech DC
            </a>{" "}
            in partnership with Four Mile Run Conservancy. Free and open source.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <strong>Disclaimer:</strong> WaterWatch DMV provides advisory information only. This is
            not a regulatory determination. Water conditions change rapidly, especially after rain
            events. Always check with local health authorities for official guidance before
            recreational water contact.
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
