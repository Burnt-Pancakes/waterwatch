import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatPlannerTime,
  getWindowQualityPresentation,
  type DepartureWindow,
  type WindowQuality,
} from "@/lib/tripPlanner";

interface WindowFinderPanelProps {
  originName: string;
  destName: string;
  selectedDate: Date;
  onDateChange: (d: Date) => void;
  windows: DepartureWindow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectWindow: (window: DepartureWindow) => void;
}

function dateChipLabel(d: Date, offset: number): string {
  const target = new Date(d);
  target.setDate(target.getDate() + offset);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (offset === 0) return "Today";
  if (
    offset === 1 &&
    target.getFullYear() === tomorrow.getFullYear() &&
    target.getMonth() === tomorrow.getMonth() &&
    target.getDate() === tomorrow.getDate()
  ) {
    return "Tomorrow";
  }
  return target.toLocaleDateString([], { month: "short", day: "numeric" });
}

const QUALITY_EMOJI: Record<WindowQuality, string> = {
  good: "✅",
  fair: "🟡",
  poor: "⬜",
};

export function WindowFinderPanel({
  originName,
  destName,
  selectedDate,
  onDateChange,
  windows,
  loading,
  error,
  onRetry,
  onSelectWindow,
}: WindowFinderPanelProps) {
  const today = new Date();
  const hasGood = windows.some((w) => w.window_quality === "good");

  return (
    <div
      className="space-y-4 bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom)+var(--focus-group-bar-height,0px))]"
      data-testid="window-finder-panel"
    >
      <div>
        <h2 className="text-lg font-semibold text-[#1A3A5C] dark:text-foreground">
          Best times to paddle
        </h2>
        <p className="text-sm text-muted-foreground">
          {originName} → {destName}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[0, 1].map((offset) => (
          <Button
            key={offset}
            type="button"
            size="sm"
            variant={
              selectedDate.toDateString() ===
              new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() + offset,
              ).toDateString()
                ? "default"
                : "outline"
            }
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() + offset);
              d.setHours(0, 0, 0, 0);
              onDateChange(d);
            }}
          >
            {dateChipLabel(today, offset)}
          </Button>
        ))}
        <input
          type="date"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          value={selectedDate.toISOString().split("T")[0]}
          onChange={(e) => onDateChange(new Date(`${e.target.value}T12:00:00`))}
          aria-label="Pick date"
        />
      </div>

      {loading && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Checking tidal windows…</p>
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:bg-red-950">
          <p>{error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && windows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tidal-assist windows for this date — try tomorrow.
        </p>
      )}

      {!loading && !error && windows.length > 0 && !hasGood && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          No tidal-assist windows today — try tomorrow
        </p>
      )}

      {!loading &&
        !error &&
        windows.map((w) => {
          const p = getWindowQualityPresentation(w.window_quality);
          return (
            <div
              key={w.departure_time}
              className={`rounded-lg border border-border bg-background p-4 shadow-sm ${p.borderClass}`}
            >
              <p className={`text-xs font-bold tracking-wide ${p.badgeClass}`}>
                {QUALITY_EMOJI[w.window_quality]} {p.label}
              </p>
              <p className="mt-2 text-sm font-medium">
                Leave {formatPlannerTime(w.departure_time)} · home by ~
                {formatPlannerTime(w.estimated_home_time)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{w.recommendation}</p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => onSelectWindow(w)}
                data-testid="plan-this-window-btn"
              >
                Plan this →
              </Button>
            </div>
          );
        })}
    </div>
  );
}
