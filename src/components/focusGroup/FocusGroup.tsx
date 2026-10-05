import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "@/components/icons";
import { FocusGroupBar } from "./FocusGroupBar";
import { FocusGroupPanel } from "./FocusGroupPanel";
import { HIDDEN_ROUTES, MAX_AUTO_PROMPTS, QUESTIONS } from "@/lib/focusGroup/config";
import { autoPromptCount, incrementAutoPromptCount, isDone, isWindowOpen } from "@/lib/focusGroup/storage";

export const FOCUS_GROUP_BAR_HEIGHT = 40;

/** localStorage key set when the first-use safety disclaimer is accepted. */
const DISCLAIMER_KEY = "watervoice_disclaimer_accepted";

/** Delay after the page becomes eligible before the intro card appears. */
const AUTO_PROMPT_DELAY_MS = 8_000;

/** Poll interval while waiting for the disclaimer / install prompt gates. */
const GATE_POLL_MS = 1_000;

/** True once the visitor has accepted the first-use safety disclaimer. */
function isDisclaimerAccepted(): boolean {
  try {
    return !!window.localStorage.getItem(DISCLAIMER_KEY);
  } catch {
    return false;
  }
}

/**
 * Mirrors InstallPrompt's show conditions without coupling to its DOM:
 * it shows when not dismissed, not installed as a PWA, and this device
 * has visited at least 3 times.
 */
function isInstallPromptShowing(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    if (window.localStorage.getItem("watervoice_install_dismissed")) return false;
    const count = Number.parseInt(
      window.localStorage.getItem("watervoice_visit_count") ?? "0",
      10,
    );
    return count >= 3;
  } catch {
    return false;
  }
}

/** True when at least one non-repeatable question has not been answered. */
function hasUnansweredQuestion(): boolean {
  return QUESTIONS.some((q) => !q.repeatable && !isDone(q.id));
}

/**
 * Owns the focus group open/closed state and renders the docked bar,
 * the automatic intro card, and the question panel. Renders nothing
 * during SSR, when the round window is closed, or on hidden routes.
 * While visible, publishes the bar height as --focus-group-bar-height
 * on <body> so pages can pad.
 */
export function FocusGroup() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  // Session guard: at most one automatic prompt per page load, and the
  // intro is never re-triggered by route changes within the session.
  const autoPromptShownRef = useRef(false);

  const introRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const visible = mounted && isWindowOpen() && !HIDDEN_ROUTES.has(currentPath);

  // Publish the bar height so pages can pad above the bar.
  useEffect(() => {
    if (!mounted) return;
    document.body.style.setProperty(
      "--focus-group-bar-height",
      visible ? `${FOCUS_GROUP_BAR_HEIGHT}px` : "0px",
    );
    return () => {
      document.body.style.setProperty("--focus-group-bar-height", "0px");
    };
  }, [mounted, visible]);

  // Automatic intro prompt: waits for the disclaimer to be accepted and
  // the install prompt to be gone, then fires once per page load after
  // ~8 seconds, respecting the per-device cap and unanswered questions.
  useEffect(() => {
    if (!visible || open || autoPromptShownRef.current) return;
    if (autoPromptCount() >= MAX_AUTO_PROMPTS) return;
    if (!hasUnansweredQuestion()) return;

    let delayTimer: number | null = null;
    const poll = window.setInterval(() => {
      if (autoPromptShownRef.current) {
        window.clearInterval(poll);
        return;
      }
      if (!isDisclaimerAccepted() || isInstallPromptShowing()) return;
      window.clearInterval(poll);
      delayTimer = window.setTimeout(() => {
        autoPromptShownRef.current = true;
        incrementAutoPromptCount();
        setIntro(true);
      }, AUTO_PROMPT_DELAY_MS);
    }, GATE_POLL_MS);

    return () => {
      window.clearInterval(poll);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
    };
  }, [visible, open, currentPath]);

  const closeIntro = useCallback(() => setIntro(false), []);

  // Focus management + Escape for the intro card.
  useEffect(() => {
    if (!intro) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    introRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeIntro();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
  }, [intro, closeIntro]);

  if (!visible) return null;

  return (
    <>
      <FocusGroupBar onOpen={() => setOpen(true)} />
      {intro && !open && (
        <div
          ref={introRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Focus group invitation"
          data-testid="focus-group-intro"
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-gray-200 bg-white p-4 pb-8 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900 sm:inset-x-auto sm:bottom-28 sm:left-4 sm:w-[340px] sm:rounded-xl sm:pb-4"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              Help shape WaterWatch DMV
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={closeIntro}
              className="shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Two minutes of questions. Answer as many or as few as you like, and
            your answers shape what gets built next.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIntro(false);
                setOpen(true);
              }}
              className="min-h-11 flex-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white dark:bg-teal-500 dark:text-gray-900"
            >
              Start
            </button>
            <button
              type="button"
              onClick={closeIntro}
              className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {open && <FocusGroupPanel onClose={() => setOpen(false)} />}
    </>
  );
}
