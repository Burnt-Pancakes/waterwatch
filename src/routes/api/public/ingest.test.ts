import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runIngestionSpy = vi.fn(async (_sourceId?: string) => ({
  sourcesRun: ["fake"],
  readingsInserted: 1,
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

describe("/api/public/ingest", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    runIngestionSpy.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", { method: "POST" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid secret and ingest result", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceId: "noaa_rain" }),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readingsInserted: number };
    expect(body.readingsInserted).toBe(1);
    expect(runIngestionSpy).toHaveBeenCalledWith("noaa_rain");
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await postHandler({
      request: new Request("http://x/api/public/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: "not json",
      }),
    });
    expect(res.status).toBe(400);
  });
});
