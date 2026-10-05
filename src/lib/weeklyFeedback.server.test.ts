import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

import {
  reportMonday,
  dueCutoff,
  buildFeedbackHtml,
  isWeeklyReportDue,
  runWeeklyFeedbackReport,
  maybeRunWeeklyFeedbackOnVisit,
  type FeedbackRow,
} from "./weeklyFeedback.server";

/** A chainable stand-in for a Supabase query builder that resolves to `result`
 * whether it's awaited directly (select().gte().order()) or terminated with
 * .maybeSingle() / .select("id"). */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  obj.select = self;
  obj.eq = self;
  obj.is = self;
  obj.lt = self;
  obj.gte = self;
  obj.order = self;
  obj.update = self;
  obj.maybeSingle = () => Promise.resolve(result);
  obj.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const NOW = new Date("2026-09-21T18:00:00Z");

beforeEach(() => {
  mockFrom.mockReset();
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
  );
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  vi.unstubAllGlobals();
});

// ── reportMonday ──────────────────────────────────────────────────────────────
describe("reportMonday", () => {
  it("returns the same day when now is already a Monday", () => {
    const monday = reportMonday(new Date("2026-09-21T12:00:00Z")); // a Monday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("returns the prior Monday for a mid-week day", () => {
    const monday = reportMonday(new Date("2026-09-24T12:00:00Z")); // Thursday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("returns the prior Monday for a Sunday", () => {
    const monday = reportMonday(new Date("2026-09-27T12:00:00Z")); // Sunday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-09-21");
  });
});

// ── dueCutoff ─────────────────────────────────────────────────────────────────
describe("dueCutoff", () => {
  it("returns a cutoff at or before `now`", () => {
    const cutoff = dueCutoff(NOW);
    expect(cutoff.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it("is stable across different times of day in the same week", () => {
    const a = dueCutoff(new Date("2026-09-23T04:00:00Z"));
    const b = dueCutoff(new Date("2026-09-25T22:00:00Z"));
    expect(a.getTime()).toBe(b.getTime());
  });
});

// ── buildFeedbackHtml ─────────────────────────────────────────────────────────
describe("buildFeedbackHtml", () => {
  it("renders option tallies, free text, empty sections, and escapes markup", () => {
    const rows: FeedbackRow[] = [
      {
        device_id: "d1",
        prompt_key: "use_before_trip",
        response_value: "Weather",
        response_text: null,
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d2",
        prompt_key: "use_before_trip",
        response_value: "Tides",
        response_text: null,
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d1",
        prompt_key: "would_share",
        response_value: "Yes",
        response_text: "would need better accuracy",
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d2",
        prompt_key: "would_share",
        response_value: "No",
        response_text: null,
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d1",
        prompt_key: "matters_most",
        response_value: "   ",
        response_text: null,
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d1",
        prompt_key: "unclear_or_trust",
        response_value: null,
        response_text: "confused me & worried me <a bit>",
        created_at: NOW.toISOString(),
      },
      {
        device_id: "d2",
        prompt_key: "check_today",
        response_value: null,
        response_text: "   ",
        created_at: NOW.toISOString(),
      },
    ];

    const html = buildFeedbackHtml(rows, reportMonday(NOW), false);

    expect(html).not.toContain("This is a test of the weekly");
    expect(html).toContain("7 response rows from 2 devices.");
    // use_before_trip: multi-select tally + note
    expect(html).toContain("Weather");
    expect(html).toContain("Multi-select: percents can sum above 100%.");
    // would_share: special Yes/of/percent takeaway
    expect(html).toContain("Yes: 1 of 2 (50%).");
    // matters_most: all values blank -> no table, no takeaway, no fallback text
    const mattersMostSection = html.split("Which one matters most?")[1].split("<h2")[0];
    expect(mattersMostSection).not.toContain("<table");
    expect(mattersMostSection).not.toContain("Leading option:");
    expect(mattersMostSection).not.toContain("No responses this week.");
    // unclear_or_trust: escaped free text
    expect(html).toContain("confused me &amp; worried me &lt;a bit&gt;");
    // a question with zero rows at all falls through the qRows.length===0 branch
    const dataSection = html.split("data we should be showing?")[1].split("<h2")[0];
    expect(dataSection).toContain("No responses this week.");
  });

  it("marks the test banner and singularizes counts for a single row", () => {
    const rows: FeedbackRow[] = [
      {
        device_id: "d1",
        prompt_key: "comments",
        response_value: null,
        response_text: "Great app!",
        created_at: NOW.toISOString(),
      },
    ];

    const html = buildFeedbackHtml(rows, reportMonday(NOW), true);

    expect(html).toContain("This is a test of the weekly");
    expect(html).toContain("1 response row from 1 device.");
    expect(html).toContain("Great app!");
  });
});

// ── isWeeklyReportDue ─────────────────────────────────────────────────────────
describe("isWeeklyReportDue", () => {
  it("returns false when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await isWeeklyReportDue(NOW)).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns true when the report has never been sent", async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null }));
    expect(await isWeeklyReportDue(NOW)).toBe(true);
  });

  it("returns true when the last send predates this week's cutoff", async () => {
    const cutoff = dueCutoff(NOW);
    const before = new Date(cutoff.getTime() - 60_000).toISOString();
    mockFrom.mockReturnValueOnce(chain({ data: { last_sent_at: before }, error: null }));
    expect(await isWeeklyReportDue(NOW)).toBe(true);
  });

  it("returns false when already sent this week", async () => {
    const cutoff = dueCutoff(NOW);
    const after = new Date(cutoff.getTime() + 60_000).toISOString();
    mockFrom.mockReturnValueOnce(chain({ data: { last_sent_at: after }, error: null }));
    expect(await isWeeklyReportDue(NOW)).toBe(false);
  });

  it("returns false on a query error", async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: "boom" } }));
    expect(await isWeeklyReportDue(NOW)).toBe(false);
  });
});

// ── runWeeklyFeedbackReport ───────────────────────────────────────────────────
describe("runWeeklyFeedbackReport", () => {
  it("returns not_configured without Supabase env vars", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await runWeeklyFeedbackReport({ now: NOW });
    expect(result).toEqual({ status: "not_configured" });
  });

  it("test mode: sends without claiming, using a null prior send as the window start", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // state read
      .mockReturnValueOnce(chain({ data: [], error: null })); // preview_feedback

    const result = await runWeeklyFeedbackReport({ test: true, now: NOW });

    expect(result.status).toBe("sent");
    if (result.status === "sent") {
      expect(result.test).toBe(true);
      expect(result.email_status).toBe("skipped_no_api_key");
      expect(result.rows_read).toBe(0);
    }
  });

  it("test mode: sends via Resend successfully when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const priorSent = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: priorSent }, error: null }))
      .mockReturnValueOnce(
        chain({
          data: [
            {
              device_id: "d1",
              prompt_key: "comments",
              response_value: null,
              response_text: "hi",
              created_at: NOW.toISOString(),
            },
          ],
          error: null,
        }),
      );

    const result = await runWeeklyFeedbackReport({ test: true, now: NOW });

    expect(result.status).toBe("sent");
    if (result.status === "sent") {
      expect(result.email_status).toBe("sent");
      expect(result.resend_status).toBe(200);
      expect(result.window_since).toBe(priorSent);
    }
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("test mode: reports a failed_<status> email_status when Resend rejects", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" }),
    );
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const result = await runWeeklyFeedbackReport({ test: true, now: NOW });

    if (result.status === "sent") {
      expect(result.email_status).toBe("failed_422");
      expect(result.resend_status).toBe(422);
    } else {
      throw new Error("expected status: sent");
    }
  });

  it("real mode: claims and sends when not yet sent this week (prior send is null)", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // state read
      .mockReturnValueOnce(chain({ data: [{ id: "weekly_feedback" }], error: null })) // claim
      .mockReturnValueOnce(chain({ data: [], error: null })); // preview_feedback

    const result = await runWeeklyFeedbackReport({ now: NOW });

    expect(result.status).toBe("sent");
  });

  it("real mode: claims and sends when the prior send predates the cutoff", async () => {
    const cutoff = dueCutoff(NOW);
    const before = new Date(cutoff.getTime() - 60_000).toISOString();
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: before }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "weekly_feedback" }], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));

    const result = await runWeeklyFeedbackReport({ now: NOW });

    expect(result.status).toBe("sent");
  });

  it("real mode: returns already_sent_this_week when the prior send is within this week", async () => {
    const cutoff = dueCutoff(NOW);
    const after = new Date(cutoff.getTime() + 60_000).toISOString();
    mockFrom.mockReturnValueOnce(chain({ data: { last_sent_at: after }, error: null }));

    const result = await runWeeklyFeedbackReport({ now: NOW });

    expect(result).toEqual({ status: "already_sent_this_week" });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("real mode: returns already_sent_this_week when a concurrent caller wins the claim race", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null })); // claim matched 0 rows

    const result = await runWeeklyFeedbackReport({ now: NOW });

    expect(result).toEqual({ status: "already_sent_this_week" });
  });

  it("real mode: throws when the claim update errors", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "db down" } }));

    await expect(runWeeklyFeedbackReport({ now: NOW })).rejects.toThrow(
      "weekly_report_state claim failed: db down",
    );
  });

  it("throws when the preview_feedback query errors", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: "timeout" } }));

    await expect(runWeeklyFeedbackReport({ test: true, now: NOW })).rejects.toThrow(
      "preview_feedback query failed: timeout",
    );
  });
});

// ── maybeRunWeeklyFeedbackOnVisit ─────────────────────────────────────────────
describe("maybeRunWeeklyFeedbackOnVisit", () => {
  it("does nothing when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(maybeRunWeeklyFeedbackOnVisit()).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("runs the report when due", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // isWeeklyReportDue
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // state read
      .mockReturnValueOnce(chain({ data: [{ id: "weekly_feedback" }], error: null })) // claim
      .mockReturnValueOnce(chain({ data: [], error: null })); // preview_feedback

    await expect(maybeRunWeeklyFeedbackOnVisit()).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledTimes(4);
  });

  it("swallows errors from a failed run", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // isWeeklyReportDue
      .mockReturnValueOnce(chain({ data: { last_sent_at: null }, error: null })) // state read
      .mockReturnValueOnce(chain({ data: null, error: { message: "db down" } })); // claim errors

    await expect(maybeRunWeeklyFeedbackOnVisit()).resolves.toBeUndefined();
  });
});
