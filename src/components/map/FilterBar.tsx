import { cn } from "@/lib/utils";
import { FILTER_OPTIONS, type SiteTypeFilter } from "./filterSites";

type FilterBarProps = {
  value: SiteTypeFilter;
  onChange: (next: SiteTypeFilter) => void;
};

/**
 * Horizontally-scrollable pill bar pinned above the bottom edge of the map.
 * Active pill uses the teal primary; inactive pills are outlined.
 */
export function FilterBar({ value, onChange }: FilterBarProps) {
  return (
    <div
      data-testid="filter-bar"
      className="pointer-events-auto flex max-w-full snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {FILTER_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`filter-${opt.value}`}
            data-active={active}
            aria-label={`Filter by ${opt.label}`}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "snap-start whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-opacity duration-200 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600",
              active
                ? "bg-primary text-primary-foreground dark:bg-teal-800 dark:text-white"
                : "border border-primary bg-background text-primary hover:bg-primary/5 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
