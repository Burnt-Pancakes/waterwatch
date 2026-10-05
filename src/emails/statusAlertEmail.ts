const STATUS_STYLES: Record<string, { label: string; bg: string; border: string; color: string }> =
  {
    pass: { label: "Pass", bg: "#EAF3DE", border: "#3B6D11", color: "#27500A" },
    caution: { label: "Caution", bg: "#FAEEDA", border: "#BA7517", color: "#633806" },
    unsafe: { label: "Unsafe", bg: "#FCEBEB", border: "#E24B4A", color: "#791F1F" },
    no_data: { label: "No Data", bg: "#F1EFE8", border: "#888780", color: "#444441" },
  };

interface StatusAlertEmailOptions {
  siteName: string;
  status: string;
  sampledAt: string;
  siteSlug: string;
  unsubscribeToken: string;
  appUrl: string;
}

export function buildStatusAlertEmail(opts: StatusAlertEmailOptions): {
  subject: string;
  html: string;
} {
  const s = STATUS_STYLES[opts.status] ?? STATUS_STYLES.no_data;
  const siteUrl = `${opts.appUrl}/sites/${opts.siteSlug}`;
  const unsubUrl = `${opts.appUrl}/api/guest-alert/unsubscribe?token=${opts.unsubscribeToken}`;
  const date = new Date(opts.sampledAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `Water quality update for ${opts.siteName} — ${s.label}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e0ddd8;overflow:hidden;">
        <tr><td style="background:#0d9488;padding:20px 32px;">
          <p style="margin:0;color:#ffffff;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;">WaterWatch DMV</p>
          <h1 style="margin:4px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Water Quality Alert</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <div style="background:${s.bg};border:1px solid ${s.border};color:${s.color};border-radius:6px;padding:12px 16px;font-size:16px;font-weight:600;">
            ${s.label} — ${opts.siteName}
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;color:#333333;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">The water quality status at <strong>${opts.siteName}</strong> has changed.</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#666666;width:120px;">Status:</td>
              <td style="padding:6px 0;font-weight:600;color:${s.color};">${s.label}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666666;">Sampled:</td>
              <td style="padding:6px 0;">${date}</td>
            </tr>
          </table>
          <p style="margin:16px 0 0;">
            <a href="${siteUrl}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;border-radius:5px;padding:10px 20px;font-size:14px;font-weight:600;">View site details</a>
          </p>
        </td></tr>
        <tr><td style="border-top:1px solid #eeeeee;padding:16px 32px;font-size:12px;color:#888888;">
          <p style="margin:0;">Advisory only. WaterWatch DMV aggregates publicly available monitoring data and is not a regulatory authority. Consult your local health authority for official guidance.</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;text-align:center;">
          <a href="${unsubUrl}" style="font-size:12px;color:#aaaaaa;">Unsubscribe from alerts for this site</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
