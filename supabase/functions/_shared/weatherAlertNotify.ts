/** Shared weather-advisory notification helpers for edge functions. */
// deno-lint-ignore-file no-explicit-any

export interface WeatherAlertInfo {
  nws_alert_id: string;
  event: string;
  severity: string | null;
  urgency: string | null;
  headline: string | null;
  description: string | null;
  effective_at: string | null;
  expires_at: string | null;
  area_desc: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function wantsWeatherAdvisoryAlerts(triggerOn: string[]): boolean {
  return triggerOn.includes("weather_advisory");
}

export function buildWeatherAlertEmail(opts: {
  siteName: string;
  siteSlug: string;
  alert: WeatherAlertInfo;
  appUrl: string;
}): { subject: string; html: string } {
  const { siteName, siteSlug, alert, appUrl } = opts;
  const siteUrl = `${appUrl}/sites/${siteSlug}`;
  const subject = `Weather advisory for ${siteName} — ${alert.event}`;

  const detailRows = [
    ["Event", alert.event],
    ["Severity", alert.severity ?? "—"],
    ["Urgency", alert.urgency ?? "—"],
    ["Effective", formatDate(alert.effective_at)],
    ["Expires", formatDate(alert.expires_at)],
    ["Area", alert.area_desc ?? "—"],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#666;width:100px;vertical-align:top;">${label}:</td><td style="padding:6px 0;">${value}</td></tr>`,
    )
    .join("");

  const headlineBlock = alert.headline
    ? `<p style="margin:0 0 12px;font-weight:600;">${alert.headline}</p>`
    : "";
  const descriptionBlock = alert.description
    ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#444;">${alert.description}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid #e0ddd8;overflow:hidden;">
        <tr><td style="background:#0d9488;padding:20px 32px;">
          <p style="margin:0;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:.05em;">WaterVoice DMV</p>
          <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">Weather Advisory</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <div style="background:#FCEBEB;border:1px solid #E24B4A;color:#791F1F;border-radius:6px;padding:12px 16px;font-size:16px;font-weight:600;">${alert.event} — ${siteName}</div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;color:#333;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">A weather advisory is in effect near <strong>${siteName}</strong>.</p>
          ${headlineBlock}
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
            ${detailRows}
          </table>
          ${descriptionBlock}
          <p style="margin:16px 0 0;"><a href="${siteUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;border-radius:5px;padding:10px 20px;font-size:14px;font-weight:600;">View site</a></p>
        </td></tr>
        <tr><td style="border-top:1px solid #eee;padding:16px 32px;font-size:12px;color:#888;">
          <p style="margin:0;">Advisory only. Weather data from the National Weather Service. Always check official sources before going on the water.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

type SupabaseClientLike = {
  from: (table: string) => any;
  auth: {
    admin: { getUserById: (id: string) => Promise<{ data: { user?: { email?: string } } }> };
  };
};

async function sendResendEmail(
  resendApiKey: string,
  emailFrom: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!resendApiKey) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend error ${res.status}: ${body}`);
  }
}

/** Notify subscribed users about active NWS advisories they have not been emailed yet. */
export async function notifyWeatherAlertSubscribers(
  db: SupabaseClientLike,
  activeAlerts: WeatherAlertInfo[],
  opts: {
    appUrl: string;
    emailFrom: string;
    resendApiKey: string;
  },
): Promise<number> {
  if (activeAlerts.length === 0 || !opts.resendApiKey) return 0;

  const { data: subscriptions } = await db
    .from("alerts")
    .select("id, user_id, site_id, trigger_on")
    .eq("is_active", true)
    .contains("trigger_on", ["weather_advisory"]);

  if (!subscriptions?.length) return 0;

  const siteIds = [...new Set(subscriptions.map((s: { site_id: string }) => s.site_id))];
  const { data: sites } = await db.from("sites").select("id, name, slug").in("id", siteIds);
  const siteById = new Map(
    (sites ?? []).map((s: { id: string; name: string; slug: string }) => [s.id, s]),
  );

  const userIds = [...new Set(subscriptions.map((s: { user_id: string }) => s.user_id))];
  const { data: profiles } = await db
    .from("user_profiles")
    .select("id, email_alerts_enabled")
    .in("id", userIds);
  const profileById = new Map(
    (profiles ?? []).map((p: { id: string; email_alerts_enabled: boolean }) => [p.id, p]),
  );

  const subIds = subscriptions.map((s: { id: string }) => s.id);
  const { data: prior } = await db
    .from("weather_alert_notifications")
    .select("alert_id, nws_alert_id")
    .in("alert_id", subIds);
  const notified = new Set(
    (prior ?? []).map(
      (r: { alert_id: string; nws_alert_id: string }) => `${r.alert_id}:${r.nws_alert_id}`,
    ),
  );

  let sent = 0;
  const emailPromises: Promise<void>[] = [];

  for (const sub of subscriptions) {
    if (!wantsWeatherAdvisoryAlerts(sub.trigger_on)) continue;

    const profile = profileById.get(sub.user_id);
    if (profile?.email_alerts_enabled === false) continue;

    const site = siteById.get(sub.site_id);
    if (!site) continue;

    const { data: userData } = await db.auth.admin.getUserById(sub.user_id);
    const email = userData?.user?.email;
    if (!email) continue;

    for (const wxAlert of activeAlerts) {
      const key = `${sub.id}:${wxAlert.nws_alert_id}`;
      if (notified.has(key)) continue;

      const { subject, html } = buildWeatherAlertEmail({
        siteName: site.name,
        siteSlug: site.slug,
        alert: wxAlert,
        appUrl: opts.appUrl,
      });

      emailPromises.push(
        sendResendEmail(opts.resendApiKey, opts.emailFrom, email, subject, html).then(() => {
          sent += 1;
        }),
      );
      emailPromises.push(
        db
          .from("weather_alert_notifications")
          .insert({ alert_id: sub.id, nws_alert_id: wxAlert.nws_alert_id })
          .then(() => undefined),
      );
      notified.add(key);
    }
  }

  await Promise.allSettled(emailPromises);
  return sent;
}
