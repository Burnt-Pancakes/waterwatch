import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!cronSecret || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  let filename: string | undefined;
  try {
    const body = await req.json();
    filename = body?.filename;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  if (!filename || typeof filename !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'filename' (string) in body" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Strip leading slashes; disallow path traversal.
  const safePath = filename.replace(/^\/+/, "");
  if (safePath.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid filename" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.storage.from("waterways").createSignedUploadUrl(safePath);

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? "Failed to sign upload URL" }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      bucket: "waterways",
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    }),
    { headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
