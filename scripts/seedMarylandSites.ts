/**
 * One-time seed script: fetches Maryland DNR public water access sites from
 * the ArcGIS Online endpoint via MarylandDNRAdapter and upserts them into
 * the Supabase `sites` table.
 *
 * Run with:
 *   npx tsx scripts/seedMarylandSites.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or in env).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { MarylandDNRAdapter } from "../src/lib/adapters/marylandDNRAdapter";

// ---------------------------------------------------------------------------
// .env loader — avoids a dotenv dependency for a standalone script
// ---------------------------------------------------------------------------
function loadDotenv(): void {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // No .env file — env vars must be provided externally
  }
}

loadDotenv();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment.",
    );
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const adapter = new MarylandDNRAdapter(db);

  console.log("Fetching Maryland DNR sites from ArcGIS endpoint...");
  const sites = await adapter.fetchSites();
  console.log(`Fetched ${sites.length} sites.`);

  if (sites.length === 0) {
    console.log("No sites returned — nothing to insert.");
    return;
  }

  // Deduplicate slugs in case two sites share the same name.
  const slugCounts = new Map<string, number>();
  const rows = sites.map((s) => {
    const base = toSlug(s.name);
    const n = slugCounts.get(base) ?? 0;
    slugCounts.set(base, n + 1);
    const slug = n === 0 ? base : `${base}-${n}`;
    return {
      name: s.name,
      slug,
      lat: s.lat,
      lng: s.lng,
      site_type: s.siteType,
      water_body_type: s.waterBodyType,
      osm_id: s.externalId,
      is_active: true,
      data_source_ids: ["mddnr"],
    };
  });

  const { data, error } = await db
    .from("sites")
    .upsert(rows, { onConflict: "name,lat,lng", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  const inserted = data?.length ?? 0;
  const skipped = rows.length - inserted;
  console.log(`\nDone. ${sites.length} sites fetched, ${inserted} inserted, ${skipped} skipped.`);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
