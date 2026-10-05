export type PlannerGeoJsonData = {
  type: string;
  features?: unknown[];
  geometry?: { type: string; coordinates: number[][] };
};

function coordinatesToLine(coordinates: [number, number][]): PlannerGeoJsonData {
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

export function routeGeoJson(routeCoordinates?: [number, number][]): PlannerGeoJsonData {
  return routeCoordinates && routeCoordinates.length >= 2
    ? coordinatesToLine(routeCoordinates)
    : { type: "FeatureCollection", features: [] };
}

export function accessConnectorsGeoJson(connectors: [number, number][][] = []): PlannerGeoJsonData {
  return {
    type: "FeatureCollection",
    features: connectors
      .filter((coordinates) => coordinates.length >= 2)
      .map((coordinates) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      })),
  };
}
