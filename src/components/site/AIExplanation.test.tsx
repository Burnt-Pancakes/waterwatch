// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AIExplanation } from "./AIExplanation";

const PROPS = {
  siteName: "Four Mile Run",
  status: "caution",
  eColiMpn: 300,
  enterococciCce: null,
  waterBodyType: "freshwater" as const,
  sampledAt: new Date().toISOString(),
  dataSource: "EPA WQP",
  recentRainInches: 0.5,
};

function makeStreamBody(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("AIExplanation component", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the 'Ask WaterVoice AI' button initially", () => {
    render(<AIExplanation {...PROPS} />);
    expect(screen.getByText("Ask WaterVoice AI")).toBeTruthy();
  });

  it("shows activity buttons after clicking 'Ask WaterVoice AI'", () => {
    render(<AIExplanation {...PROPS} />);
    fireEvent.click(screen.getByText("Ask WaterVoice AI"));
    expect(screen.getByTestId("activity-swimming")).toBeTruthy();
    expect(screen.getByTestId("activity-kayaking")).toBeTruthy();
    expect(screen.getByTestId("activity-wading")).toBeTruthy();
    expect(screen.getByTestId("activity-fishing")).toBeTruthy();
  });

  it("shows loading indicator while fetch is in progress", async () => {
    let resolveStream!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveStream = resolve;
    });
    vi.mocked(global.fetch).mockReturnValue(pendingFetch);

    render(<AIExplanation {...PROPS} />);
    fireEvent.click(screen.getByText("Ask WaterVoice AI"));
    fireEvent.click(screen.getByTestId("activity-swimming"));

    await waitFor(() => {
      expect(screen.getByTestId("loading-indicator")).toBeTruthy();
    });

    // Clean up pending promise
    resolveStream(
      new Response(makeStreamBody("done"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });

  it("displays disclaimer text after a successful response", async () => {
    const aiText = "Bacteria are elevated. This is advisory only, not a regulatory determination.";
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(makeStreamBody(aiText), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    render(<AIExplanation {...PROPS} />);
    fireEvent.click(screen.getByText("Ask WaterVoice AI"));
    fireEvent.click(screen.getByTestId("activity-swimming"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-response")).toBeTruthy();
    });

    // Disclaimer paragraph is always visible once the panel is open;
    // use getAllBy since the AI response itself may echo the same phrase.
    const disclaimerMatches = screen.getAllByText(/Not a regulatory determination/i);
    expect(disclaimerMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Try again in an hour' error message on 429", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limit exceeded", code: "rate_limit_exceeded" }), {
        status: 429,
      }),
    );

    render(<AIExplanation {...PROPS} />);
    fireEvent.click(screen.getByText("Ask WaterVoice AI"));
    fireEvent.click(screen.getByTestId("activity-swimming"));

    await waitFor(() => {
      expect(screen.getByTestId("error-rate-limit")).toBeTruthy();
    });
    expect(screen.getByText(/Try again in an hour/i)).toBeTruthy();
  });

  it("shows 'AI explanation unavailable' error message on 500", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Server error", code: "server_error" }), {
        status: 500,
      }),
    );

    render(<AIExplanation {...PROPS} />);
    fireEvent.click(screen.getByText("Ask WaterVoice AI"));
    fireEvent.click(screen.getByTestId("activity-swimming"));

    await waitFor(() => {
      expect(screen.getByTestId("error-other")).toBeTruthy();
    });
    expect(screen.getByText(/AI explanation unavailable/i)).toBeTruthy();
  });
});
