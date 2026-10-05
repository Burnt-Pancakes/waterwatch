// @vitest-environment jsdom
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { classifyStage } from "./riverStageUtils";
import { RiverStage } from "./RiverStage";

beforeAll(() => {
  if (typeof window.ResizeObserver === "undefined") {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ── Shared test data ──────────────────────────────────────────────────────────

const MOCK_GAUGE = {
  id: "g1",
  usgs_site_number: "01652500",
  name: "Four Mile Run at Alexandria, VA",
};

const MOCK_THRESHOLDS = {
  too_low_ft: 0.5,
  optimal_min_ft: 0.5,
  optimal_max_ft: 2.5,
  caution_max_ft: 4.0,
  notes: null,
};

const MOCK_HISTORY = [
  {
    recorded_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    stage_ft: 1.42,
    flow_cfs: 320,
    trend: "steady" as const,
  },
  {
    recorded_at: new Date(Date.now() - 65 * 60_000).toISOString(),
    stage_ft: 1.4,
    flow_cfs: 310,
    trend: null,
  },
];

// ── Mock chain builders ───────────────────────────────────────────────────────

type AnyChain = ReturnType<typeof supabase.from>;

function makeSiteChain(gaugeId: string | null): AnyChain {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: gaugeId !== null ? { nearest_gauge_id: gaugeId } : null,
      error: null,
    }),
  } as unknown as AnyChain;
}

function makeGaugeSingleChain(gauge: typeof MOCK_GAUGE | null): AnyChain {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: gauge, error: null }),
  } as unknown as AnyChain;
}

function makeThreshChain(thresholds: typeof MOCK_THRESHOLDS | null): AnyChain {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: thresholds, error: null }),
  } as unknown as AnyChain;
}

function makeReadingsChain(history: typeof MOCK_HISTORY | []): AnyChain {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: history, error: null }),
  } as unknown as AnyChain;
}

function setupMocks(
  gaugeId: string | null,
  history: typeof MOCK_HISTORY | [] = MOCK_HISTORY,
  thresholds: typeof MOCK_THRESHOLDS | null = MOCK_THRESHOLDS,
) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "sites") return makeSiteChain(gaugeId);
    if (table === "river_gauges") return makeGaugeSingleChain(gaugeId ? MOCK_GAUGE : null);
    if (table === "stage_thresholds") return makeThreshChain(thresholds);
    if (table === "gauge_readings") return makeReadingsChain(history);
    return makeSiteChain(null);
  });
}

// ── classifyStage unit tests ──────────────────────────────────────────────────

describe("classifyStage", () => {
  const t = {
    too_low_ft: 0.5,
    optimal_min_ft: 0.5,
    optimal_max_ft: 2.5,
    caution_max_ft: 4,
    notes: null,
  };
  it("flags too low", () => expect(classifyStage(0.3, t)?.label).toBe("Too low"));
  it("flags optimal", () => expect(classifyStage(1.5, t)?.label).toBe("Optimal"));
  it("flags caution", () => expect(classifyStage(3, t)?.label).toBe("Caution"));
  it("flags flood", () => expect(classifyStage(5, t)?.label).toBe("Flood"));
  it("skips too_low when threshold is 0", () =>
    expect(classifyStage(0.1, { ...t, too_low_ft: 0 })?.label).not.toBe("Too low"));
});

// ── RiverStage component tests ────────────────────────────────────────────────

describe("RiverStage component", () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when site has no linked gauge", async () => {
    setupMocks(null);
    const { container } = render(<RiverStage siteId="x" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders stage, badge and trend when data exists", async () => {
    setupMocks("g1");
    render(<RiverStage siteId="site-1" />);
    await waitFor(() => expect(screen.getByTestId("river-stage")).toBeTruthy());
    expect(screen.getByTestId("stage-value").textContent).toBe("1.42");
    expect(screen.getByTestId("stage-badge").textContent).toBe("Optimal");
    expect(screen.getByTestId("stage-trend").textContent).toBe("→");
    expect(screen.getByTestId("stage-flow").textContent).toContain("320");
  });

  it("shows unavailable placeholder when there is no current reading", async () => {
    setupMocks("g1", [], null);
    render(<RiverStage siteId="site-1" />);
    await waitFor(() => expect(screen.getByTestId("river-stage")).toBeTruthy());
    expect(screen.getByText("River data unavailable")).toBeTruthy();
  });
});
