/**
 * Weekly focus-group feedback digest — shared server logic.
 *
 * Used by the public endpoint (`/api/public/send-weekly-feedback`, called by
 * pg_cron) and by the visit-triggered backstop in `src/start.ts`, so a cold
 * app server that silently drops the Monday cron request still results in the
 * report going out on the next real app use.
 *
 * Sending is claimed atomically through `public.weekly_report_state` so the
 * cron and a concurrent visit can never both send.
 */

import { createClient } from "@supabase/supabase-js";

const RECIPIENT = "rajivsundar@gmail.com";
const RESEND_API_URL = "https://api.resend.com/emails";
const REPORT_TZ = "America/New_York";
const REPORT_HOUR_LOCAL = 9;
const STATE_ID = "weekly_feedback";

interface QuestionDef {
  key: string;
  text: string;
  hasOptions: boolean;
}

/** Mirrors QUESTIONS in src/lib/focusGroup/config.ts, in display order. */
export const QUESTIONS: QuestionDef[] = [
  {
    key: "use_before_trip",
    text: "Of what the app shows now, which would you actually use before a trip?",
    hasOptions: true,
  },
  { key: "matters_most", text: "Which one matters most?", hasOptions: true },
  { key: "unclear_or_trust", text: "Was anything unclear, or hard to trust?", hasOptions: false },
  {
    key: "add_one_thing",
    text: "If we could add one thing, which would change whether your community uses this?",
    hasOptions: true,
  },
  {
    key: "would_share",
    text: "Would your organization share this with your community?",
    hasOptions: true,
  },
  { key: "answering_for", text: "Who are you answering for?", hasOptions: true },
  {
    key: "check_today",
    text: "Before someone in your community gets on the water today, what do they check, and where?",
    hasOptions: false,
  },
  {
    key: "data_we_should_show",
    text: "Do you collect, or know of, data we should be showing?",
    hasOptions: false,
  },
  { key: "comments", text: "Any other comments?", hasOptions: false },
];

export interface FeedbackRow {
  device_id: string;
  prompt_key: string;
  response_value: string | null;
  response_text: string | null;
  created_at: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Monday (UTC) of the week the report covers. */
export function reportMonday(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Wall-clock parts of an instant in the report timezone. */
function zonedParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    weekday: get("weekday"),
  };
}

/** Converts a wall-clock time in the report timezone to a UTC instant. */
function zonedToUtc(year: number, month: number, day: number, hour: number): Date {
  let utc = Date.UTC(year, month - 1, day, hour);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(utc));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour);
    const wanted = Date.UTC(year, month - 1, day, hour);
    utc += wanted - seen;
  }
  return new Date(utc);
}

/**
 * The most recent Monday 09:00 America/New_York, as a UTC instant.
 * Derived from the IANA zone, so it stays correct across DST changes.
 */
export function dueCutoff(now: Date = new Date()): Date {
  for (let back = 0; back <= 8; back++) {
    const probe = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
    const p = zonedParts(probe);
    if (p.weekday !== "Mon") continue;
    const cutoff = zonedToUtc(p.year, p.month, p.day, REPORT_HOUR_LOCAL);
    if (cutoff.getTime() <= now.getTime()) return cutoff;
  }
  // Fallback: a week before the coming Monday cutoff.
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

const TEST_BANNER = `<p style="margin:0 0 16px;padding:12px 14px;background:#fef9c3;border:2px solid #eab308;border-radius:6px;font-size:14px;font-weight:bold;color:#713f12;">This is a test of the weekly WaterWatch feedback email. No action needed.</p>`;

/** Builds the full HTML report body. Exported for tests. */
export function buildFeedbackHtml(rows: FeedbackRow[], monday: Date, isTest = false): string {
  const sections: string[] = [];

  for (const q of QUESTIONS) {
    const qRows = rows.filter((r) => r.prompt_key === q.key);
    sections.push(
      `<h2 style="font-size:16px;margin:28px 0 8px;color:#0f172a;">${escapeHtml(q.text)}</h2>`,
    );

    if (qRows.length === 0) {
      sections.push(`<p style="margin:0;color:#555;">No responses this week.</p>`);
      continue;
    }

    // Percent denominator: distinct devices that answered this prompt_key.
    // Multi-select questions can therefore sum above 100% — intentional.
    const deviceCount = new Set(qRows.map((r) => r.device_id)).size;

    if (q.hasOptions) {
      const counts = new Map<string, number>();
      for (const r of qRows) {
        const v = (r.response_value ?? "").trim();
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

      if (sorted.length > 0) {
        const body = sorted
          .map(([opt, count]) => {
            const pct = deviceCount > 0 ? Math.round((count / deviceCount) * 100) : 0;
            return `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(opt)}</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${count}</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${pct}%</td></tr>`;
          })
          .join("");
        sections.push(
          `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 8px;"><thead><tr><th style="padding:6px 10px;border:1px solid #ddd;text-align:left;background:#f1f5f9;">Option</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:right;background:#f1f5f9;">Count</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:right;background:#f1f5f9;">Percent</th></tr></thead><tbody>${body}</tbody></table>`,
        );

        const takeaways: string[] = [
          `${deviceCount} device${deviceCount === 1 ? "" : "s"} answered this question.`,
        ];
        if (q.key === "would_share") {
          const yes = counts.get("Yes") ?? 0;
          const yesPct = deviceCount > 0 ? Math.round((yes / deviceCount) * 100) : 0;
          takeaways.push(`Yes: ${yes} of ${deviceCount} (${yesPct}%).`);
        } else {
          const [topOpt, topCount] = sorted[0];
          const topPct = deviceCount > 0 ? Math.round((topCount / deviceCount) * 100) : 0;
          takeaways.push(`Leading option: ${escapeHtml(topOpt)} — ${topCount} (${topPct}%).`);
        }
        if (q.key === "use_before_trip") {
          takeaways.push("Multi-select: percents can sum above 100%.");
        }
        sections.push(
          `<p style="margin:0 0 8px;color:#334155;font-size:13px;">${takeaways.join(" ")}</p>`,
        );
      }
    }

    // Verbatim free text, including text attached to option questions.
    const texts = qRows.map((r) => (r.response_text ?? "").trim()).filter((t) => t.length > 0);
    if (texts.length > 0) {
      sections.push(
        `<ul style="margin:8px 0 0;padding-left:20px;font-size:14px;color:#111;">${texts
          .map((t) => `<li style="margin:0 0 4px;">${escapeHtml(t)}</li>`)
          .join("")}</ul>`,
      );
    } else if (!q.hasOptions) {
      sections.push(`<p style="margin:0;color:#555;">No responses this week.</p>`);
    }
  }

  const devices = new Set(rows.map((r) => r.device_id)).size;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111;">
  ${isTest ? TEST_BANNER : ""}
  <h1 style="font-size:20px;margin:0 0 4px;">WaterWatch feedback — week of ${formatDate(monday)}</h1>
  <p style="margin:0 0 4px;color:#555;font-size:13px;">Focus group responses from the last 7 days.</p>
  <p style="margin:0 0 12px;color:#555;font-size:13px;">${rows.length} response row${rows.length === 1 ? "" : "s"} from ${devices} device${devices === 1 ? "" : "s"}.</p>
  ${sections.join("\n")}
</body></html>`;
}

function serviceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

/** Cheap read used by the visit backstop before doing any real work. */
export async function isWeeklyReportDue(now = new Date()): Promise<boolean> {
  const supabase = serviceClient();
  if (!supabase) return false;
  const cutoff = dueCutoff(now);
  if (now.getTime() < cutoff.getTime()) return false;
  const { data, error } = await supabase
    .from("weekly_report_state")
    .select("last_sent_at")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (error) return false;
  const last = (data as { last_sent_at: string | null } | null)?.last_sent_at ?? null;
  return last === null || new Date(last).getTime() < cutoff.getTime();
}

export type WeeklyReportResult =
  | { status: "already_sent_this_week" | "not_due_yet" | "not_configured" }
  | {
      status: "sent";
      rows_read: number;
      distinct_devices: number;
      questions_with_responses: number;
      email_status: string;
      resend_status?: number;
      subject: string;
      test: boolean;
      window_since: string;
    };

/**
 * Runs the weekly report. In test mode it always sends and never touches
 * `last_sent_at`; otherwise it atomically claims the week before sending.
 */
export async function runWeeklyFeedbackReport(
  opts: { test?: boolean; now?: Date } = {},
): Promise<WeeklyReportResult> {
  const test = opts.test === true;
  const now = opts.now ?? new Date();
  const supabase = serviceClient();
  if (!supabase) return { status: "not_configured" };

  const cutoff = dueCutoff(now);

  const { data: stateRow } = await supabase
    .from("weekly_report_state")
    .select("last_sent_at")
    .eq("id", STATE_ID)
    .maybeSingle();
  const priorLastSent = (stateRow as { last_sent_at: string | null } | null)?.last_sent_at ?? null;

  if (!test) {
    if (now.getTime() < cutoff.getTime()) return { status: "not_due_yet" };
    if (priorLastSent !== null && new Date(priorLastSent).getTime() >= cutoff.getTime()) {
      return { status: "already_sent_this_week" };
    }
    // Atomic claim: only one caller can move last_sent_at past the cutoff.
    let claim = supabase
      .from("weekly_report_state")
      .update({ last_sent_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", STATE_ID);
    claim = priorLastSent === null ? claim.is("last_sent_at", null) : claim.lt("last_sent_at", cutoff.toISOString());
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) throw new Error(`weekly_report_state claim failed: ${claimError.message}`);
    if (!claimed || claimed.length !== 1) return { status: "already_sent_this_week" };
  }

  // Window: everything since the previous send; first run falls back to 7 days.
  const since = priorLastSent ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("preview_feedback")
    .select("device_id, prompt_key, response_value, response_text, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`preview_feedback query failed: ${error.message}`);

  const rows = (data ?? []) as FeedbackRow[];
  const monday = reportMonday(now);
  const subject = `${test ? "[TEST] " : ""}WaterWatch feedback — week of ${formatDate(monday)}`;
  const html = buildFeedbackHtml(rows, monday, test);

  const resendKey = process.env.RESEND_API_KEY ?? "";
  const emailFrom = process.env.EMAIL_FROM ?? "WaterWatch DMV <alerts@watervoice.app>";

  let emailStatus = "skipped_no_api_key";
  let resendStatus: number | undefined;
  if (resendKey) {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: emailFrom, to: [RECIPIENT], subject, html }),
    });
    resendStatus = res.status;
    if (!res.ok) {
      const text = await res.text();
      console.error(`Resend send failed [${res.status}]: ${text}`);
      emailStatus = `failed_${res.status}`;
    } else {
      emailStatus = "sent";
    }
  }

  return {
    status: "sent",
    rows_read: rows.length,
    distinct_devices: new Set(rows.map((r) => r.device_id)).size,
    questions_with_responses: QUESTIONS.filter((q) => rows.some((r) => r.prompt_key === q.key))
      .length,
    email_status: emailStatus,
    resend_status: resendStatus,
    subject,
    test,
    window_since: since,
  };
}

/** Fire-and-forget backstop used on real page requests. Never throws. */
export async function maybeRunWeeklyFeedbackOnVisit(): Promise<void> {
  try {
    if (!(await isWeeklyReportDue())) return;
    await runWeeklyFeedbackReport();
  } catch (err) {
    console.error("weekly feedback backstop failed", err);
  }
}
