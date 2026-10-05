import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbRow = Record<string, unknown>;
type MockResult = { data: DbRow[] | null; error: null; count?: number };
type MockBuilder = {
  table: string;
  selectClause: string | null;
  eqs: Array<{ key: string; value: unknown }>;
  insertValue: unknown;
  getResult: () => MockResult;
  then(
    resolve: (value: unknown) => unknown,
    reject: (reason?: unknown) => unknown,
  ): Promise<unknown>;
  catch(onRejected: (reason: unknown) => unknown): Promise<unknown>;
  select(s: string, opts?: unknown): MockBuilder;
  eq(key: string, value: unknown): MockBuilder;
  gte(key: string, value: unknown): MockBuilder;
  insert(value: unknown): MockBuilder;
};
type PostHandler = (ctx: { request: Request }) => Promise<Response>;
type RouteWithPostHandler = unknown;

const mockRpc = { current: vi.fn() };
const mockFrom = { current: vi.fn() };

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc.current(...args),
    from: (...args: unknown[]) => mockFrom.current(...args),
  },
}));

const mockStream = { current: vi.fn() };

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: (...args: unknown[]) => mockStream.current(...args),
      };
    },
  };
});

import { Route as ExplainRoute, SYSTEM_PROMPT } from "./explain";

function createBuilder(table: string) {
  const builder: MockBuilder = {
    table,
    selectClause: null,
    eqs: [] as Array<{ key: string; value: unknown }>,
    insertValue: null,
    then(resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) {
      try {
        const result = builder.getResult();
        return Promise.resolve(result).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    },
    catch(onRejected: (reason: unknown) => unknown) {
      return Promise.resolve(builder.getResult()).catch(onRejected);
    },
    select(_selectClause: string, _opts?: unknown) {
      builder.selectClause = _selectClause;
      return builder;
    },
    eq(key: string, value: unknown) {
      builder.eqs.push({ key, value });
      return builder;
    },
    gte(key: string, value: unknown) {
      builder.eqs.push({ key, value });
      return builder;
    },
    insert(value: unknown) {
      builder.insertValue = value;
      return builder;
    },
    getResult: () => ({ data: null, error: null }),
  };
  return builder;
}

const routeHandler = (Route: RouteWithPostHandler) =>
  (Route as { options: { server: { handlers: { POST: PostHandler } } } }).options.server.handlers
    .POST;

function makeRequest(body: unknown = {}) {
  return new Request("http://x/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  siteName: "Four Mile Run",
  status: "caution",
  eColiMpn: 300,
  enterococciCce: null,
  waterBodyType: "freshwater",
  sampledAt: new Date().toISOString(),
  dataSource: "EPA WQP",
  activity: "swimming",
  recentRainInches: 0.5,
};

describe("/api/explain route", () => {
  let state: { authRateLimitCount: number };

  beforeEach(() => {
    state = { authRateLimitCount: 0 };

    mockFrom.current = vi.fn((table: string) => {
      const builder = createBuilder(table);
      if (table === "auth_rate_limits") {
        builder.getResult = () => ({
          data: [],
          count: state.authRateLimitCount,
          error: null,
        });
      }
      return builder;
    });

    // Default mock: stream yields two text deltas then done
    mockStream.current = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Bacteria levels are elevated. " },
        };
        yield {
          type: "content_block_delta",
          delta: {
            type: "text_delta",
            text: "This is advisory only, not a regulatory determination.",
          },
        };
      },
    }));

    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns 400 for missing required fields", async () => {
    const res = await routeHandler(ExplainRoute)({
      request: makeRequest({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_body");
  });

  it("returns 400 when activity is not a valid enum value", async () => {
    const res = await routeHandler(ExplainRoute)({
      request: makeRequest({ ...VALID_BODY, activity: "parasailing" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_body");
  });

  it("returns 429 when rate limit of 10 requests per hour is exceeded", async () => {
    state.authRateLimitCount = 10;
    const res = await routeHandler(ExplainRoute)({
      request: makeRequest(VALID_BODY),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("rate_limit_exceeded");
    expect(res.headers.get("Retry-After")).toBe("3600");
  });

  it("returns SSE stream with text/event-stream content type", async () => {
    const res = await routeHandler(ExplainRoute)({
      request: makeRequest(VALID_BODY),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("streams Anthropic response chunks as SSE data events", async () => {
    const res = await routeHandler(ExplainRoute)({
      request: makeRequest(VALID_BODY),
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
    }

    expect(raw).toContain("data: ");
    expect(raw).toContain("[DONE]");
    // Verify text content from the mocked Anthropic stream
    expect(raw).toContain("Bacteria levels are elevated");
  });

  it("SYSTEM_PROMPT forbids claiming water is 100% safe or that users will not get sick", () => {
    expect(SYSTEM_PROMPT).toMatch(/never claim/i);
    expect(SYSTEM_PROMPT).toMatch(/100%/);
    expect(SYSTEM_PROMPT).toMatch(/will not get sick/i);
  });

  it("SYSTEM_PROMPT requires advisory-only closing sentence", () => {
    expect(SYSTEM_PROMPT).toContain("This is advisory only, not a regulatory determination.");
  });
});
