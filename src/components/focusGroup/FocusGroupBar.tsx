import { MessageCircle } from "@/components/icons";
import { CLOSE_DATE } from "@/lib/focusGroup/config";

/**
 * Formats an ISO date string for the bar's "open through" label.
 * Falls back to the raw string if parsing fails.
 */
function formatCloseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

interface FocusGroupBarProps {
  onOpen: () => void;
}

/**
 * Slim docked bar that sits directly above the BottomTabBar.
 * Tapping anywhere opens the focus group question panel.
 * Mounted only client-side after the window/route gate passes.
 */
export function FocusGroupBar({ onOpen }: FocusGroupBarProps) {
  return (
    <button
      type="button"
      data-testid="focus-group-bar"
      onClick={onOpen}
      className="fixed left-0 right-0 z-40 flex h-10 w-full items-center justify-between border-t border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900"
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      aria-label="Open focus group feedback"
    >
      <span className="flex items-center gap-2 text-xs font-medium text-teal-700 dark:text-teal-500">
        <MessageCircle size={14} aria-hidden="true" />
        <span>Share Feedback</span>
        {CLOSE_DATE !== null && (
          <span className="font-normal text-gray-500 dark:text-gray-400">
            open through {formatCloseDate(CLOSE_DATE)}
          </span>
        )}
      </span>
    </button>
  );
}
