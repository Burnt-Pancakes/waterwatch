import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { All, Beach, BoatRamp, Fishing, Jellyfish, Kayak, Marina, MapHome, Plan, Rivers, SwimArea, Tides, Warning } from "./index";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "./defaults";

describe("shared icon catalog", () => {
  it("provides all site, navigation, and condition aliases as renderable icons", () => {
    for (const Icon of [All, Beach, BoatRamp, Fishing, Jellyfish, Kayak, Marina, MapHome, Plan, Rivers, SwimArea, Tides, Warning]) {
      expect(renderToStaticMarkup(<Icon size={22} />)).toContain("<svg");
    }
  });

  it("renders the distinct supplied and Material drawings at requested size", () => {
    const drawings = [
        [Tides, "0 0 24 24"],
      [Kayak, "0 -960 960 960"],
      [SwimArea, "0 -960 960 960"],
    ] as const;
    for (const [Icon, viewBox] of drawings) {
      const markup = renderToStaticMarkup(<Icon size={16} className="text-primary" />);
      expect(markup).toContain(`viewBox="${viewBox}"`);
      expect(markup).toContain('width="16"');
      expect(markup).toContain('class="text-primary"');
    }
    expect(renderToStaticMarkup(<Kayak />)).not.toBe(renderToStaticMarkup(<SwimArea />));
  });

  it("uses shared Lucide dimensions by default and permits stroke overrides", () => {
    expect(ICON_SIZE).toBe(24);
    expect(ICON_STROKE_WIDTH).toBe(2);
    for (const Icon of [Rivers, Tides, Kayak, SwimArea, Jellyfish]) {
      const markup = renderToStaticMarkup(<Icon />);
      expect(markup).toContain('width="24"');
      expect(markup).toContain('stroke-width="2"');
      expect(renderToStaticMarkup(<Icon size={18} strokeWidth={3} />)).toContain('stroke-width="3"');
    }
  });
});
