import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title} — WaterWatch DMV</title>
<style>body{font-family:Georgia,serif;background:#f9f9f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #e0ddd8;border-radius:8px;padding:32px 40px;max-width:480px;text-align:center}
h1{color:#0d9488;font-size:22px;margin:0 0 12px}p{color:#555;font-size:15px;line-height:1.6;margin:0 0 16px}
a{color:#0d9488;text-decoration:none;font-size:14px}</style></head>
<body><div class="card"><h1>${title}</h1>${body}</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/guest-alert/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");

        if (!token) {
          return htmlPage(
            "Invalid link",
            "<p>This unsubscribe link is missing a token. Please use the link from your alert email.</p>",
          );
        }

        const { error } = await supabaseAdmin.from("guest_alerts").delete().eq("token", token);

        if (error) {
          console.error("Unsubscribe delete error:", error);
          return htmlPage(
            "Something went wrong",
            "<p>We couldn't process your unsubscribe request. Please try again later.</p>",
          );
        }

        return htmlPage(
          "Unsubscribed",
          `<p>You've been removed from water quality alerts for this site.</p>
<p>You can always re-subscribe from the site's page.</p>
<a href="/">Return to WaterWatch DMV</a>`,
        );
      },
    },
  },
});
