import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

const STORAGE_KEY = "watervoice_disclaimer_accepted";
const INFORMATIONAL_ROUTES = new Set(["/about", "/terms", "/privacy"]);

export function FirstUseDisclaimer() {
  const [mounted, setMounted] = useState(false);
  const [accepted, setAccepted] = useState(true);
  const currentPath = useRouterState({ select: (state) => state.location.pathname });

  // Client-only — avoid SSR mismatch.
  useEffect(() => {
    setAccepted(typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY));
    setMounted(true);
  }, []);

  if (!mounted || accepted || INFORMATIONAL_ROUTES.has(currentPath)) return null;

  const handleAccept = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    setAccepted(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      data-testid="first-use-disclaimer"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900 dark:text-gray-200">
        <div className="overflow-y-auto px-6 pt-6">
          <h2 id="disclaimer-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Important safety information
          </h2>

          <div className="mt-3 space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            <p>
              WaterVoice DMV displays water quality data collected by government agencies and
              third-party sources. This information is provided for general informational purposes
              only and does not constitute a safety determination, health advisory, or
              recommendation to enter the water.
            </p>
            <p>Data limitations you should know:</p>
            <ul className="list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
              <li>
                Water quality readings reflect conditions at a specific sampling point at the time
                of collection. Conditions may differ at other locations within the same site,
                upstream, or downstream.
              </li>
              <li>
                Water quality can change rapidly — particularly within 24–72 hours following rain
                events — regardless of the most recent sample result.
              </li>
              <li>
                Sample data may be days or weeks old. Always check the sample date displayed on each
                site.
              </li>
              <li>
                WaterVoice DMV does not collect, verify, or independently test water quality data.
                All readings are sourced from third-party agencies including DOEE, DC Water, USGS,
                and others. We are not responsible for the accuracy, timeliness, or completeness of
                third-party data.
              </li>
            </ul>
            <p>
              Always check official sources before entering the water. Official health advisories
              from DC DOH, Maryland MDE, and Virginia DEQ take precedence over any information
              displayed in this app.
            </p>
            <p>
              By continuing, you acknowledge that recreational water use carries inherent risks,
              that WaterVoice DMV and its contributors are not liable for any illness, injury, or
              harm arising from reliance on information displayed in this app, and that you assume
              full responsibility for your decision to enter the water.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
            <Link
              to="/about"
              className="underline underline-offset-4 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
            >
              About WaterVoice
            </Link>
            <a
              href="/terms"
              className="underline underline-offset-4 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
            >
              Terms of Use
            </a>
            <a
              href="/privacy"
              className="underline underline-offset-4 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
            >
              Privacy Policy
            </a>
          </div>
        </div>

        <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={handleAccept}
            data-testid="disclaimer-accept-btn"
            className="w-full rounded-lg bg-teal-700 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
          >
            I understand — take me to the map
          </button>
        </div>
      </div>
    </div>
  );
}
