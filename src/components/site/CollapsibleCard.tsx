import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  /** Optional leading icon element (already sized/coloured). */
  icon?: ReactNode;
  /** Compact status shown in the collapsed header once loaded (e.g. "Optimal"). */
  summary?: ReactNode;
  /** Renders a skeleton body and disables toggling. */
  loading?: boolean;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
};

/**
 * Section card with loading / minimized / expanded states.
 * Minimized shows only the title (plus a summary chip when available).
 */
export function CollapsibleCard({
  title,
  icon,
  summary,
  loading = false,
  defaultOpen = false,
  testId,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      data-testid={testId}
      data-state={loading ? "loading" : open ? "expanded" : "minimized"}
      className="overflow-hidden rounded-lg border border-border bg-card dark:border-gray-700 dark:bg-gray-800"
    >
      <button
        type="button"
        onClick={() => !loading && setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        disabled={loading}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default"
      >
        {icon}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground dark:text-white">
          {title}
        </h3>
        {loading ? <span className="h-4 w-16 animate-pulse rounded-full bg-muted" /> : summary}
        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={contentId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open && !loading ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 px-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
