import { createFileRoute, Link } from "@tanstack/react-router";
import { Info } from "@/components/icons";
import { AuthNav } from "@/components/auth/AuthNav";
import { WaterVoiceMap } from "@/components/map/WaterVoiceMap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:title", content: "WaterWatch DMV — Real-time water quality for the DC area" },
      { property: "og:description", content: "Check water quality across DC-area water access points with WaterWatch DMV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "WaterWatch DMV — Real-time water quality for the DC area" },
      {
        name: "description",
        content:
          "Real-time fecal bacteria status at kayak launches, boat ramps, beaches, and swim areas across the DC Metro area, using EPA 2012 Recreational Water Quality Criteria.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div data-fullscreen-page className="relative bg-background text-foreground">
      {/* Floating brand + auth header over the full-screen map */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3">
        <div className="pointer-events-auto flex h-9 items-center rounded-md bg-white/75 px-3 shadow-sm ring-1 ring-black/20 dark:bg-gray-900/75 dark:ring-white/25">
          <span className="text-sm font-bold text-primary dark:text-teal-300">WaterWatch DMV</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Link
            to="/about"
            aria-label="About WaterWatch"
            title="About WaterWatch"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/75 text-primary shadow-sm ring-1 ring-black/20 transition-colors hover:bg-white/90 dark:bg-gray-900/75 dark:text-teal-300 dark:ring-white/25 dark:hover:bg-teal-900/30"
          >
            <Info size={16} aria-hidden />
          </Link>
          <AuthNav />
        </div>
      </header>
      <WaterVoiceMap />
    </div>
  );
}
