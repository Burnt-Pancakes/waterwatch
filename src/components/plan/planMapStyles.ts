/** Shared MapLibre basemap styles for the trip planner (mirrors WaterVoiceMap). */

export const DC_CENTER: [number, number] = [-77.0369, 38.9072];

const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/">CARTO</a>';

function makeCartoStyle(variant: "voyager" | "dark_all") {
  const key = import.meta.env.VITE_CARTO_API_KEY;
  const suffix = key ? `?key=${key}` : "";
  return {
    version: 8 as const,
    sources: {
      carto: {
        type: "raster" as const,
        tiles: [`https://basemaps.cartocdn.com/rastertiles/${variant}/{z}/{x}/{y}@2x.png${suffix}`],
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "carto-tiles",
        type: "raster" as const,
        source: "carto",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}

export const PLAN_MAP_LIGHT_STYLE = makeCartoStyle("voyager");
export const PLAN_MAP_DARK_STYLE = makeCartoStyle("dark_all");
