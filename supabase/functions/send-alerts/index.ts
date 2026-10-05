// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStatus, shouldFireAlert } from "../_shared/waterQuality.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = Deno.env.get("SITE_URL") ?? "https://watervoice.app";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "WaterVoice DMV <alerts@watervoice.app>";

const STATUS_STYLES: Record<string, { label: string; bg: string; border: string; color: string }> =
  {
    pass: { label: "Pass", bg: "#EAF3DE", border: "#3B6D11", color: "#27500A" },
    caution: { label: "Caution", bg: "#FAEEDA", border: "#BA7517", color: "#633806" },
    unsafe: { label: "Unsafe", bg: "#FCEBEB", border: "#E24B4A", color: "#791F1F" },
    no_data: { label: "No Data", bg: "#F1EFE8", border: "#888780", color: "#444441" },
  };

function buildAlertHtml(opts: {
  siteName: string;
  status: string;
  sampledAt: string;
  siteSlug: string;
  unsubscribeUrl: string | null;
}): { subject: string; html: string } {
  const s = STATUS_STYLES[opts.status] ?? STATUS_STYLES.no_data;
  const siteUrl = `${APP_URL}/sites/${opts.siteSlug}`;
  const date = new Date(opts.sampledAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `Water quality update for ${opts.siteName} — ${s.label}`;
  const unsubRow = opts.unsubscribeUrl
    ? `<tr><td style="padding:0 32px 24px;text-align:center;"><a href="${opts.unsubscribeUrl}" style="font-size:12px;color:#aaaaaa;">Unsubscribe</a></td></tr>`
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
          <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">Water Quality Alert</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 0;">
          <div style="background:${s.bg};border:1px solid ${s.border};color:${s.color};border-radius:6px;padding:12px 16px;font-size:16px;font-weight:600;">${s.label} — ${opts.siteName}</div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;color:#333;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">The water quality status at <strong>${opts.siteName}</strong> has changed.</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#666;width:120px;">Status:</td><td style="padding:6px 0;font-weight:600;color:${s.color};">${s.label}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Sampled:</td><td style="padding:6px 0;">${date}</td></tr>
          </table>
          <p style="margin:16px 0 0;"><a href="${siteUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;border-radius:5px;padding:10px 20px;font-size:14px;font-weight:600;">View site</a></p>
        </td></tr>
        <tr><td style="border-top:1px solid #eee;padding:16px 32px;font-size:12px;color:#888;">
          <p style="margin:0;">Advisory only. WaterVoice DMV aggregates publicly available monitoring data and is not a regulatory authority.</p>
        </td></tr>
        ${unsubRow}
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend error ${res.status}: ${body}`);
  }
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${SERVICE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let reading_id: string, site_id: string;
  try {
    const body = await req.json();
    reading_id = body.reading_id;
    site_id = body.site_id;
    if (!reading_id || !site_id) throw new Error("Missing fields");
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Fetch the new reading + site
  const { data: reading } = await supabase
    .from("readings")
    .select("id, site_id, e_coli_mpn, enterococci_cce, sampled_at")
    .eq("id", reading_id)
    .single();

  if (!reading) return new Response("Reading not found", { status: 404 });

  const { data: site } = await supabase
    .from("sites")
    .select("water_body_type, name, slug")
    .eq("id", site_id)
    .single();

  if (!site) return new Response("Site not found", { status: 404 });

  const newStatus = computeStatus(
    reading.e_coli_mpn,
    reading.enterococci_cce,
    site.water_body_type,
  );

  // Get previous reading for this site
  const { data: prevReadings } = await supabase
    .from("readings")
    .select("e_coli_mpn, enterococci_cce")
    .eq("site_id", site_id)
    .neq("id", reading_id)
    .lt("sampled_at", reading.sampled_at)
    .order("sampled_at", { ascending: false })
    .limit(1);

  const prev = prevReadings?.[0] ?? null;
  const prevStatus = prev
    ? computeStatus(prev.e_coli_mpn, prev.enterococci_cce, site.water_body_type)
    : "no_data";

  const emailPromises: Promise<void>[] = [];

  // User alerts
  const { data: userAlerts } = await supabase
    .from("alerts")
    .select("id, user_id, trigger_on")
    .eq("site_id", site_id)
    .eq("is_active", true);

  for (const alert of userAlerts ?? []) {
    const statusTriggers = alert.trigger_on.filter((t: string) => t !== "weather_advisory");
    if (!shouldFireAlert(statusTriggers, prevStatus, newStatus)) continue;

    const { data: userData } = await supabase.auth.admin.getUserById(alert.user_id);
    const email = userData?.user?.email;
    if (!email) continue;

    const { subject, html } = buildAlertHtml({
      siteName: site.name,
      status: newStatus,
      sampledAt: reading.sampled_at,
      siteSlug: site.slug,
      unsubscribeUrl: null,
    });

    emailPromises.push(sendEmail(email, subject, html));
    emailPromises.push(
      supabase
        .from("alerts")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", alert.id)
        .then(() => undefined),
    );
  }

  // Guest alerts — notify on any status change
  if (prevStatus !== newStatus) {
    const { data: guestAlerts } = await supabase
      .from("guest_alerts")
      .select("email, token")
      .eq("site_id", site_id);

    for (const guest of guestAlerts ?? []) {
      const unsubscribeUrl = `${APP_URL}/api/guest-alert/unsubscribe?token=${guest.token}`;
      const { subject, html } = buildAlertHtml({
        siteName: site.name,
        status: newStatus,
        sampledAt: reading.sampled_at,
        siteSlug: site.slug,
        unsubscribeUrl,
      });
      emailPromises.push(sendEmail(guest.email, subject, html));
    }
  }

  await Promise.allSettled(emailPromises);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
