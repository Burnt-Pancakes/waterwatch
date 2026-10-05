import { describe, expect, it } from "vitest";
import { accessConnectorsGeoJson, routeGeoJson } from "./tripPlannerMapGeoJson";

describe("TripPlannerMap route data", () => {
  it("draws no line when a verified route is unavailable", () => {
    expect(routeGeoJson()).toEqual({ type: "FeatureCollection", features: [] });
    expect(routeGeoJson([])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("keeps verified paddling geometry and access connectors in separate sources", () => {
    const route = routeGeoJson([
      [-77.05, 38.84],
      [-77.04, 38.86],
    ]);
    const access = accessConnectorsGeoJson([
      [
        [-77.051, 38.839],
        [-77.05, 38.84],
      ],
    ]);
    expect(route.features).toHaveLength(1);
    expect(access.features).toHaveLength(1);
    expect(route).not.toEqual(access);
  });
});
