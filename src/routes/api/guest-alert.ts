import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkApiRateLimit,
  errorResponse,
  getRequestIp,
  parseBody,
  rateLimitHeaders,
} from "@/lib/apiRoute.server";
import { sendEmail } from "@/lib/resend.server";

const bodySchema = z.object({
  email: z.string().email(),
  siteId: z.string().uuid(),
});

function buildConfirmationEmail(opts: {
  siteName: string;
  siteSlug: string;
  unsubscribeToken: string;
  appUrl: string;
}): string {
  const siteUrl = `${opts.appUrl}/sites/${opts.siteSlug}`;
  const unsubUrl = `${opts.appUrl}/api/guest-alert/unsubscribe?token=${opts.unsubscribeToken}`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f7;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e0ddd8;overflow:hidden;">
        <tr><td style="background:#0d9488;padding:20px 32px;">
          <p style="margin:0;color:#ffffff;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;">WaterWatch DMV</p>
          <h1 style="margin:4px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Alert subscription confirmed</h1>
        </td></tr>
        <tr><td style="padding:24px 32px;color:#333333;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">You'll receive an email whenever the water quality status changes at <strong>${opts.siteName}</strong>.</p>
          <p style="margin:0 0 16px;"><a href="${siteUrl}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;border-radius:5px;padding:10px 20px;font-size:14px;font-weight:600;">View site now</a></p>
          <p style="margin:0;font-size:12px;color:#888888;">Advisory only — not a regulatory determination. <a href="${unsubUrl}" style="color:#aaaaaa;">Unsubscribe</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const Route = createFileRoute("/api/guest-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getRequestIp(request);
        const rate = await checkApiRateLimit(ip, "api_guest_alert", {
          limit: 10,
          windowSeconds: 3600,
        });

        if (!rate.allowed) {
          return errorResponse("Rate limit exceeded", "rate_limit_exceeded", 429, null, {
            ...rateLimitHeaders(rate),
            "Retry-After": String(rate.retryAfterSeconds),
          });
        }

        let body: z.infer<typeof bodySchema>;
        try {
          body = await parseBody(request, bodySchema);
        } catch (err) {
          return errorResponse(
            "Invalid request body",
            "invalid_body",
            400,
            err instanceof Error ? err.message : undefined,
            rateLimitHeaders(rate),
          );
        }

        const { data: site, error: siteErr } = await supabaseAdmin
          .from("sites")
          .select("id, name, slug")
          .eq("id", body.siteId)
          .eq("is_active", true)
          .maybeSingle();

        if (siteErr || !site) {
          return errorResponse("Site not found", "site_not_found", 404);
        }

        // Upsert — UNIQUE(email, site_id) deduplicates silently.
        const { data: guestAlert, error: insertErr } = await supabaseAdmin
          .from("guest_alerts")
          .upsert({ email: body.email, site_id: body.siteId }, { onConflict: "email,site_id" })
          .select("token")
          .single();

        if (insertErr || !guestAlert) {
          console.error("guest_alert upsert error:", insertErr);
          return errorResponse("Failed to save subscription", "db_error", 500);
        }

        const appUrl = process.env.SITE_URL ?? "http://localhost:8080";
        await sendEmail({
          to: body.email,
          subject: `You're subscribed to alerts for ${site.name} — WaterWatch DMV`,
          html: buildConfirmationEmail({
            siteName: site.name,
            siteSlug: site.slug,
            unsubscribeToken: guestAlert.token,
            appUrl,
          }),
        }).catch((err) => {
          console.error("Confirmation email failed:", err);
        });

        return Response.json({ ok: true }, { status: 201 });
      },
    },
  },
});
