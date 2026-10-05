import type { LucideProps } from "lucide-react";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "./defaults";

/**
 * Tides icon: falling-tide (down) and rising-tide (up) arrows over two waves.
 * Approved Proposal D — Lucide-style 24x24, 2px round strokes, 2pt gap between arrows.
 */
export function TidesIcon({ size = ICON_SIZE, strokeWidth = ICON_STROKE_WIDTH, color = "currentColor", className, ...props }: LucideProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" color={color} className={className} {...props}>
      {/* Down arrow (falling tide), top left: shaft + open head = 3 segments */}
      <path d="M7 2v10" />
      <path d="M3 7 7 12l4-5" />
      {/* Up arrow (rising tide), top right: shaft + open head = 3 segments */}
      <path d="M17 12V2" />
      <path d="M13 7 17 2l4 5" />
      {/* Waves */}
      <path d="M3 16.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3-1.4 4.5 0" />
      <path d="M3 21c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3-1.4 4.5 0" />
    </svg>
  );
}
