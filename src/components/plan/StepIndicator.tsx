import { cn } from "@/lib/utils";
import type { PlannerStep } from "@/lib/tripPlanner";

const STEPS: Array<{ id: PlannerStep; label: string; num: string }> = [
  { id: "route", label: "Route", num: "①" },
  { id: "windows", label: "Windows", num: "②" },
  { id: "timeline", label: "Timeline", num: "③" },
];

export function StepIndicator({
  current,
  onStepClick,
}: {
  current: PlannerStep;
  onStepClick?: (step: PlannerStep) => void;
}) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);

  return (
    <nav
      aria-label="Trip planner steps"
      className="flex items-center justify-center gap-2 border-b border-border bg-card px-3 py-2 text-xs"
      data-testid="plan-step-indicator"
    >
      {STEPS.map((step, idx) => {
        const isActive = step.id === current;
        const isPast = idx < currentIdx;
        const clickable = onStepClick && (isPast || isActive);

        return (
          <div key={step.id} className="flex items-center gap-2">
            {idx > 0 && <span className="text-muted-foreground">→</span>}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(step.id)}
              className={cn(
                "rounded-full px-2 py-1 font-medium transition-colors",
                isActive && "bg-teal-700 text-white dark:bg-teal-600",
                isPast && !isActive && "text-teal-700 dark:text-teal-400",
                !isActive && !isPast && "text-muted-foreground",
                clickable && "hover:bg-muted",
              )}
            >
              {step.num} {step.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
