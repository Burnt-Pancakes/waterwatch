import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Layers, Map, Moon, Satellite } from "@/components/icons";

export type MapStyleMode = "map" | "dark" | "satellite";
export const MAP_STYLE_STORAGE_KEY = "watervoice_map_style";

type MapStyleSwitcherProps = {
  currentStyle: MapStyleMode;
  onChange: (style: MapStyleMode) => void;
};

const STYLE_OPTIONS: Array<{
  id: MapStyleMode;
  label: string;
  Icon: typeof Map;
}> = [
  { id: "map", label: "Map", Icon: Map },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "satellite", label: "Satellite", Icon: Satellite },
];

/**
 * Compact basemap-style pill that visually matches MapFilterPill.
 * Collapsed: layers icon + current label + chevron.
 * Expanded (tap on touch, hover on desktop) shows a dropdown of options.
 * Selecting an option collapses the pill.
 */
export function MapStyleSwitcher({ currentStyle, onChange }: MapStyleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = STYLE_OPTIONS.find((o) => o.id === currentStyle) ?? STYLE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      data-testid="map-style-switcher"
      role="group"
      aria-label="Change basemap style"
      className="pointer-events-auto relative"
      onMouseEnter={() => {
        if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
          setOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        data-testid="style-switcher-toggle"
        aria-label="Change basemap style"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 items-center gap-2 rounded-full px-3 shadow-md ring-1 transition-[background-color,box-shadow] duration-150 ${
          open
            ? "bg-white ring-2 ring-teal-500 dark:bg-gray-900"
            : "bg-white/75 ring-black/20 dark:bg-gray-900/75 dark:ring-white/25"
        }`}
      >
        <Layers size={16} className="shrink-0 text-gray-400" aria-hidden />
        <span className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
          {current.label}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-10 pb-2">
          <div
            role="listbox"
            aria-label="Basemap style"
            className="min-w-[160px] overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5 dark:bg-gray-900"
          >
            {STYLE_OPTIONS.map((opt) => {
              const isActive = opt.id === currentStyle;
              const OptIcon = opt.Icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-testid={`style-btn-${opt.id}`}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${
                    isActive
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                      : "text-gray-900 hover:bg-teal-100 hover:text-teal-900 dark:text-gray-100 dark:hover:bg-teal-900/20 dark:hover:text-teal-300"
                  }`}
                >
                  <Check
                    size={14}
                    aria-hidden
                    className={`shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                  />
                  <OptIcon
                    size={16}
                    aria-hidden
                    className={`shrink-0 ${isActive ? "text-teal-600 dark:text-teal-300" : "text-gray-500"}`}
                  />
                  <span className="whitespace-nowrap">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
