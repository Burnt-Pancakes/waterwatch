/** Pure helpers for weather-advisory email notifications (no I/O). */

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
          <p style="margin:0;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:.05em;">WaterWatch DMV</p>
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
