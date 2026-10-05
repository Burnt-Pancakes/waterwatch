"use client";
import { useEffect, useRef, useState } from "react";

const VISIT_KEY = "watervoice_visit_count";
const DISMISSED_KEY = "watervoice_install_dismissed";

/**
 * PWA install prompt banner shown after the user's 3rd visit.
 * Uses the browser's beforeinstallprompt event to trigger the native
 * add-to-home-screen dialog. Dismissed state is persisted in localStorage.
 */
export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef<(Event & { prompt(): Promise<void> }) | null>(null);

  useEffect(() => {
    // Don't show if already installed as PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Increment visit count
    const count = parseInt(localStorage.getItem(VISIT_KEY) ?? "0", 10) + 1;
    localStorage.setItem(VISIT_KEY, String(count));

    // Show after 3rd visit
    if (count >= 3) setShow(true);

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as Event & { prompt(): Promise<void> };
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!show) return null;

  const handleAdd = async () => {
    if (deferredPrompt.current) {
      await deferredPrompt.current.prompt();
    }
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  };

  return (
    <div
      className="fixed left-0 right-0 z-40 flex items-center justify-between px-4"
      style={{
        bottom: "calc(4rem + env(safe-area-inset-bottom) + var(--focus-group-bar-height, 0px))",
        height: "60px",
        backgroundColor: "#00695C",
      }}
    >
      <p className="text-sm text-white flex-1 mr-3">
        Add WaterVoice to your home screen for quick access before your next paddle
      </p>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={handleAdd}
          className="rounded bg-white px-3 py-1 text-sm font-medium text-teal-800"
        >
          Add
        </button>
        <button
          onClick={handleDismiss}
          className="rounded border border-white px-3 py-1 text-sm font-medium text-white"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
