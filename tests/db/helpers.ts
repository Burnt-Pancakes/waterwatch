import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../../src/integrations/supabase/types";

/**
 * Reads Supabase URL + keys only when integration tests are explicitly
 * enabled. This prevents a normal unit-test run from touching a live project
 * merely because Vite loaded credentials from a local .env file.
 */
export function getSupabaseEnv() {
  if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return null;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;
  return { url, anon, service };
}

/** Anonymous (unauthenticated) Supabase client used for RLS checks. */
export function anonClient(
  env: NonNullable<ReturnType<typeof getSupabaseEnv>>,
): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

/** Service-role client (only when the key is present). */
export function adminClient(
  env: NonNullable<ReturnType<typeof getSupabaseEnv>>,
): SupabaseClient<Database> | null {
  if (!env.service) return null;
  return createClient<Database>(env.url, env.service, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}
