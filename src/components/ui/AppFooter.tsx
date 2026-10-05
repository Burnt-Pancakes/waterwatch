import { Link } from "@tanstack/react-router";
import { DISCLAIMERS } from "@/lib/waterQualityEngine";

export function AppFooter() {
  return (
    <footer className="border-t-2 border-teal-700 bg-background py-6 px-4">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">{DISCLAIMERS.footer}</p>

        <nav aria-label="Footer links" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {[
            { label: "About", to: "/about" },
            { label: "Terms", to: "/terms" },
            { label: "Privacy", to: "/privacy" },
            { label: "Contact", to: "/" },
          ].map(({ label, to }) => (
            <Link
              key={label}
              to={to}
              className="text-sm text-gray-500 underline-offset-4 hover:text-teal-700 hover:underline dark:text-gray-400 dark:hover:text-teal-400"
            >
              {label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-gray-400 dark:text-gray-500">
          Built by{" "}
          <a
            href="https://civictechdc.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-teal-700 dark:hover:text-teal-400"
          >
            CivicTech DC
          </a>
        </p>
      </div>
    </footer>
  );
}
