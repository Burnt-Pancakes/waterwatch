import { ICON_SIZE, ICON_STROKE_WIDTH } from "@/components/icons/defaults";

type Props = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/**
 * Simple line-art jellyfish glyph drawn in the same visual language as the
 * Lucide icons used in the bottom tab bar (24x24 viewBox, currentColor
 * stroke, 2px stroke width, round caps/joins).
 *
 * Lucide has no jellyfish icon, so this is a hand-drawn node kept local to
 * the jellyfish module.
 */
export function JellyfishIcon({ size = ICON_SIZE, strokeWidth = ICON_STROKE_WIDTH, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Bell */}
      <path d="M4 12a8 8 0 0 1 16 0" />
      <path d="M4 12h16" />
      {/* Tentacles */}
      <path d="M8 12c0 2.5-1.5 3.5-1.5 5.5" />
      <path d="M12 12c0 3 1 4 1 6.5" />
      <path d="M16 12c0 2.5 1.5 3.5 1.5 5.5" />
    </svg>
  );
}
