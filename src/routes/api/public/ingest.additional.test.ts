/**
 * Additional coverage for the /api/public/ingest handler — error paths and
 * body variants not covered by the primary ingest.test.ts file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runIngestionSpy = vi.fn(async (_sourceId?: string) => ({
  sourcesRun: ["fake"],
  readingsInserted: 2,
  readingsSkipped: 0,
  errors: [] as Array<{ source: string; message: string }>,
}));

vi.mock("@/lib/ingest.server", () => ({
  runIngestion: (sourceId?: string) => runIngestionSpy(sourceId),
}));

import { Route } from "./ingest";

const postHandler = (
  Route as unknown as {
    options: {
      server: {
        handlers: { POST: (ctx: { request: Request }) => Promise<Response> };
      };
    };
  }
).options.server.handlers.POST;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  runIngestionSpy.mockClear();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

// ── missing CRON_SECRET env ───────────────────────────────────────────────────
describe("ingest — server misconfiguration", () => {
  it("returns 500 when CRON_SECRET is not configured on the server", async () => {
    delete process.env.CRON_SECRET;

    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer anything" },
      }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/CRON_SECRET/);
  });
});

// ── valid secret with body variants ──────────────────────────────────────────
describe("ingest — body variants", () => {
  it("runs all sources when the body is empty (no sourceId supplied)", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        // No body — request.text() returns ""
      }),
    });

    expect(res.status).toBe(200);
    // runIngestion called with no sourceId argument (undefined)
    expect(runIngestionSpy).toHaveBeenCalledWith(undefined);
  });

  it("runs all sources when body is present but contains no sourceId field", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ something: "else" }),
      }),
    });

    expect(res.status).toBe(200);
    expect(runIngestionSpy).toHaveBeenCalledWith(undefined);
  });

  it("passes the sourceId to runIngestion when present", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceId: "usgs_wqp" }),
      }),
    });

    expect(res.status).toBe(200);
    expect(runIngestionSpy).toHaveBeenCalledWith("usgs_wqp");
  });

  it("ignores a non-string sourceId value in the body", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceId: 42 }),
      }),
    });

    expect(res.status).toBe(200);
    // sourceId: 42 is not a string — handler falls through to undefined
    expect(runIngestionSpy).toHaveBeenCalledWith(undefined);
  });
});

// ── Authorization header variants ─────────────────────────────────────────────
describe("ingest — authorization variants", () => {
  it("accepts the secret without the 'Bearer ' prefix (raw header value)", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "test-secret" },
      }),
    });

    expect(res.status).toBe(200);
  });

  it("returns 200 JSON with ingestion result shape", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
      }),
    });

    const body = (await res.json()) as {
      sourcesRun: string[];
      readingsInserted: number;
      readingsSkipped: number;
    };
    expect(body).toMatchObject({
      sourcesRun: ["fake"],
      readingsInserted: 2,
      readingsSkipped: 0,
    });
  });
});
