import type { LucideProps } from "lucide-react";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "./defaults";

/** Default fill: warning yellow used by the stale-data marker overlay. */
export const WARNING_FILL_DEFAULT = "#EAB308";

/** White accent (outline + exclamation) — the current map overlay treatment. */
export const WARNING_STROKE_WHITE = "#FFFFFF";

/** Dark brown (near-black) accent, kept for use on light backgrounds. */
export const WARNING_STROKE_DARK = "#3D2B1F";

/**
 * Filled warning triangle: solid fill with a configurable accent color for the
 * exclamation point and triangle outline. Reads clearly at marker-overlay sizes
 * where Lucide's stroked triangle looks hollow. Uses Lucide's triangle path.
 */
export function WarningIcon({
  size = ICON_SIZE,
  strokeWidth = ICON_STROKE_WIDTH,
  color = WARNING_FILL_DEFAULT,
  strokeColor = WARNING_STROKE_WHITE,
  className,
  ...props
}: LucideProps & { strokeColor?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
      className={className}
      {...props}
    >
      {/* Triangle: filled with the warning color, outlined in the accent */}
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        fill={color}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Exclamation point in the accent color */}
      <path d="M12 9v4" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 17h.01" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
