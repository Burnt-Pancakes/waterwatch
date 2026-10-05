import { describe, it, expect } from "vitest";
import { getSupabaseEnv, anonClient, adminClient } from "./helpers";
import { fourMileRunSites } from "../../src/lib/seed/fourMileRunSites";

const env = getSupabaseEnv();
const d = env ? describe : describe.skip;

d("database schema", () => {
  const anon = env ? anonClient(env) : null;

  it("RLS blocks unauthenticated INSERT on favorites", async () => {
    // Anon insert must be denied by RLS — no policy permits anon writes.
    const { error } = await anon!.from("favorites").insert({
      // Random uuids; we never expect this to succeed.
      user_id: "00000000-0000-0000-0000-000000000000",
      site_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });

  it("anon can SELECT sites (public read)", async () => {
    const { error } = await anon!.from("sites").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("get_sites_with_latest_reading returns rows ordered by distance_km asc", async () => {
    const admin = adminClient(env!);
    if (!admin) return; // skip when service role key unavailable

    // Seed via upsert so the test is idempotent.
    await admin.from("sites").upsert(fourMileRunSites, { onConflict: "slug" });

    const { data, error } = await admin.rpc("get_sites_with_latest_reading", {
      user_lat: 38.8583,
      user_lng: -77.0675,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data && data.length >= 2) {
      // Ordering invariant: distance_km is non-decreasing.
      for (let i = 1; i < data.length; i++) {
        expect(data[i].distance_km).toBeGreaterThanOrEqual(data[i - 1].distance_km);
      }
    }
  });

  it("required columns exist on every table", async () => {
    const admin = adminClient(env!);
    if (!admin) return;

    const checks = [
      { table: "sites", col: "slug" },
      { table: "readings", col: "status" },
      { table: "user_profiles", col: "email_alerts_enabled" },
      { table: "favorites", col: "user_id" },
      { table: "alerts", col: "trigger_on" },
      { table: "rain_events", col: "precipitation_inches_48h" },
    ] as const;

    for (const { table, col } of checks) {
      const { error } = await admin.from(table).select(col).limit(0);
      expect(error, `${table}.${col} should exist`).toBeNull();
    }
  });

  it("auth.users trigger creates a user_profiles row", async () => {
    const admin = adminClient(env!);
    if (!admin) return;

    const email = `test-${Date.now()}@watervoice.test`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: "Test1234!Strong",
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    const userId = created?.user?.id;
    expect(userId).toBeTruthy();

    try {
      const { data: profile } = await admin
        .from("user_profiles")
        .select("id, email_alerts_enabled")
        .eq("id", userId!)
        .single();
      expect(profile?.id).toBe(userId);
      // Default value asserted by trigger + column default.
      expect(profile?.email_alerts_enabled).toBe(true);
    } finally {
      // Cleanup so reruns don't leak users.
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
