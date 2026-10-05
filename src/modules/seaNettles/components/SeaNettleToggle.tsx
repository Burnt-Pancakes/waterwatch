import { TOGGLE_LABEL } from "../content";
import { Jellyfish } from "@/components/icons";

type Props = {
  active: boolean;
  onToggle: () => void;
};

/**
 * Map control that turns the jellyfish buoy layer on/off. Sized and
 * positioned to match the other floating right-side controls
 * (zoom/locate/style switcher) in WaterVoiceMap.tsx.
 *
 * Enabled: teal fill with a white glyph and a dark-teal 2px outline — the
 * same stroke weight station markers use (SiteMarker.tsx).
 * Disabled: the same grey as an unselected bottom tab bar item.
 */
export function SeaNettleToggle({ active, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`${active ? "Hide" : "Show"} ${TOGGLE_LABEL.toLowerCase()} layer`}
      data-testid="sea-nettle-toggle"
      className={`grid h-11 w-11 place-items-center rounded-full shadow-md ring-1 transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-teal-600 ${
        active
          ? "bg-teal-700 text-white ring-transparent dark:bg-teal-500"
          : "bg-white/75 text-primary ring-black/20 hover:bg-white/90 hover:text-teal-700 dark:bg-gray-900/75 dark:text-teal-300 dark:ring-white/25 dark:hover:bg-teal-900/30"
      }`}
      style={active ? { border: "2px solid #134E4A" } : undefined}
      title={TOGGLE_LABEL}
    >
      <Jellyfish size={22} />
    </button>
  );
}
