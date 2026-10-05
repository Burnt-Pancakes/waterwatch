import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  lines?: number;
  className?: string;
}

export function SkeletonCard({ lines = 3, className }: SkeletonCardProps) {
  return (
    <div className={cn("animate-pulse space-y-3", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-4 rounded-md bg-gray-200 dark:bg-gray-700",
            i === 0 && "w-3/4",
            i === 1 && "w-full",
            i >= 2 && "w-5/6",
          )}
        />
      ))}
    </div>
  );
}
