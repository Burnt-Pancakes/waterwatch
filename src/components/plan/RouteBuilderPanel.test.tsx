// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteBuilderPanel } from "./RouteBuilderPanel";
import { WaterRouteRequestError, type ScenicWaterRoute } from "@/lib/tripPlanner";

const sites = [
  {
    id: "launch",
    name: "A launch with a deliberately long responsive name",
    slug: "launch",
    lat: 38.84,
    lng: -77.05,
    site_type: "kayak_launch",
    is_tidal: true,
    tidal_gauge_station_id: "NOAA-1",
  },
  {
    id: "destination",
    name: "Destination",
    slug: "destination",
    lat: 38.86,
    lng: -77.04,
    site_type: "kayak_launch",
    is_tidal: true,
    tidal_gauge_station_id: "NOAA-1",
  },
];

const waypoints = sites.map((site, index) => ({
  order_index: index,
  name: site.name,
  lat: site.lat,
  lng: site.lng,
  site_id: site.id,
  noaa_station_id: "NOAA-1",
}));

const route: ScenicWaterRoute = {
  dataVersion: "2026-07-15",
  profile: "scenic_water",
  coordinates: [
    [-77.05, 38.84],
    [-77.04, 38.86],
  ],
  distanceMeters: 3704,
  scenicScore: 0.8,
  scenicHighlights: ["Natural shoreline", "Quieter water corridor"],
  warnings: [],
  legs: [
    {
      fromIndex: 0,
      toIndex: 1,
      coordinates: [
        [-77.05, 38.84],
        [-77.04, 38.86],
      ],
      distanceMeters: 3704,
      scenicScore: 0.8,
      snapDistancesMeters: [5, 8],
      accessConnectors: [],
      waterProvenance: "osm_centerline",
      scenicHighlights: ["Natural shoreline"],
      warnings: [],
    },
  ],
};

afterEach(cleanup);

function renderPanel(overrides: Partial<React.ComponentProps<typeof RouteBuilderPanel>> = {}) {
  const onFindWindows = vi.fn();
  render(
    <RouteBuilderPanel
      sites={sites}
      waypoints={waypoints}
      route={null}
      routeSegments={[]}
      tripType="out_and_back"
      speedKnots={3}
      showAllSites={false}
      onShowAllSitesChange={vi.fn()}
      onWaypointsChange={vi.fn()}
      onTripTypeChange={vi.fn()}
      onSpeedChange={vi.fn()}
      onFindWindows={onFindWindows}
      canFindWindows={false}
      skipTidalWindows={false}
      {...overrides}
    />,
  );
  return onFindWindows;
}

describe("RouteBuilderPanel routing states", () => {
  it("gates progression and never displays direct-line totals on route failure", () => {
    renderPanel({
      routingError: new WaterRouteRequestError(
        "NO_WATER_ROUTE",
        0,
        "No connected all-water route is available.",
      ),
    });
    expect(screen.getByText("No verified all-water route")).toBeTruthy();
    expect(screen.getByText(/Leg 1:/)).toBeTruthy();
    expect(screen.queryByText(/^Total:/)).toBeNull();
    expect(screen.getByTestId("find-windows-btn").hasAttribute("disabled")).toBe(true);
  });

  it("shows verified scenic totals and enables the next step", () => {
    const onFindWindows = renderPanel({
      route,
      routeSegments: [{ coordinates: route.coordinates, distanceNm: 2, viaWater: true }],
      canFindWindows: true,
    });
    expect(screen.getByText("Scenic water route")).toBeTruthy();
    expect(screen.getByText("Natural shoreline")).toBeTruthy();
    fireEvent.click(screen.getByTestId("find-windows-btn"));
    expect(onFindWindows).toHaveBeenCalledOnce();
  });

  it("uses a stable status card while routing", () => {
    renderPanel({ routeLoading: true });
    expect(screen.getByRole("status").textContent).toContain("Finding a scenic water route");
    expect(screen.getByTestId("find-windows-btn").hasAttribute("disabled")).toBe(true);
  });
});
