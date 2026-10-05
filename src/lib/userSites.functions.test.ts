import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({
      inputValidator: () => ({ handler: (fn: unknown) => fn }),
      handler: (fn: unknown) => fn,
    }),
  }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: vi.fn(),
}));

type ChainResult = { data?: unknown; error?: { message?: string; code?: string } | null };

function makeChain(result: ChainResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of [
    "select",
    "eq",
    "neq",
    "in",
    "gte",
    "order",
    "limit",
    "delete",
    "upsert",
    "insert",
    "update",
  ]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (...args: unknown[]) =>
    Promise.resolve(result).then(
      args[0] as (v: ChainResult) => unknown,
      args[1] as ((r: unknown) => unknown) | undefined,
    );
  return chain;
}

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: mockSupabase,
}));

import {
  createUserSite,
  updateUserSite,
  deleteUserSite,
  listUserSites,
} from "./userSites.functions";

type Handler<I, O> = (args: { data: I; context: { userId: string } }) => Promise<O>;
type NoDataHandler<O> = (args: { context: { userId: string } }) => Promise<O>;

const listHandler = listUserSites as unknown as NoDataHandler<
  {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    lat: number;
    lng: number;
    owner_id: string;
  }[]
>;

const createHandler = createUserSite as unknown as Handler<
  {
    name: string;
    description?: string | null;
    lat: number;
    lng: number;
    site_type?: string;
    water_body_type?: string;
  },
  unknown
>;
const updateHandler = updateUserSite as unknown as Handler<
  { siteId: string; name: string; description?: string | null },
  unknown
>;
const deleteHandler = deleteUserSite as unknown as Handler<{ siteId: string }, { ok: true }>;

const USER_A_ID = "user-a-uuid-0001";
const USER_B_ID = "user-b-uuid-0002";
const SITE_ID = "site-uuid-0001-0000-0000-000000000001";
const MOCK_UUID = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue(MOCK_UUID) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── createUserSite ─────────────────────────────────────────────────────────────
describe("createUserSite", () => {
  it("inserts with owner_id, status=personal, source=user, is_active=true", async () => {
    const siteRow = { id: MOCK_UUID, slug: "my-spot-aaaabbbb", name: "My Spot" };
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: siteRow, error: null }));
    const chain = makeChain({ data: siteRow, error: null });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await createHandler({
      data: { name: "My Spot", lat: 38.9, lng: -77.0 },
      context: { userId: USER_A_ID },
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("sites");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: USER_A_ID,
        status: "personal",
        source: "user",
        is_active: true,
      }),
    );
  });

  it("generates slug from name + uuid prefix", async () => {
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: {}, error: null }));
    const chain = makeChain({ data: {}, error: null });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await createHandler({
      data: { name: "Hains Point!", lat: 38.87, lng: -77.02 },
      context: { userId: USER_A_ID },
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "hains-point-aaaabbbb" }),
    );
  });

  it("uses uuid fragment alone as slug when name produces empty base", async () => {
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: {}, error: null }));
    const chain = makeChain({ data: {}, error: null });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await createHandler({
      data: { name: "!!!###", lat: 38.9, lng: -77.0 },
      context: { userId: USER_A_ID },
    });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ slug: "aaaabbbb" }));
  });

  it("uses the generated uuid as the explicit row id", async () => {
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: {}, error: null }));
    const chain = makeChain({ data: {}, error: null });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await createHandler({
      data: { name: "Test", lat: 38.9, lng: -77.0 },
      context: { userId: USER_A_ID },
    });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ id: MOCK_UUID }));
  });

  it("returns the site row returned by the DB", async () => {
    const siteRow = { id: MOCK_UUID, name: "My Spot", slug: "my-spot-aaaabbbb" };
    const insertSpy = vi.fn().mockReturnValue(makeChain({ data: siteRow, error: null }));
    const chain = makeChain({ data: siteRow, error: null });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    const result = await createHandler({
      data: { name: "My Spot", lat: 38.9, lng: -77.0 },
      context: { userId: USER_A_ID },
    });

    expect(result).toEqual(siteRow);
  });

  it("translates PostgreSQL 23505 unique violation to a friendly message", async () => {
    const insertSpy = vi.fn().mockReturnValue(
      makeChain({
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      }),
    );
    const chain = makeChain({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await expect(
      createHandler({
        data: { name: "Test", lat: 38.9, lng: -77.0 },
        context: { userId: USER_A_ID },
      }),
    ).rejects.toThrow("You already have a spot with that exact name and location.");
  });

  it("translates duplicate-key-value message (no 23505 code) to a friendly message", async () => {
    // Covers the || right-hand branch: code !== "23505" but message matches the regex.
    const insertSpy = vi.fn().mockReturnValue(
      makeChain({
        data: null,
        error: { code: "UNIQUE", message: "duplicate key value violates unique constraint" },
      }),
    );
    const chain = makeChain({
      data: null,
      error: { code: "UNIQUE", message: "duplicate key value violates unique constraint" },
    });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await expect(
      createHandler({
        data: { name: "Test", lat: 38.9, lng: -77.0 },
        context: { userId: USER_A_ID },
      }),
    ).rejects.toThrow("You already have a spot with that exact name and location.");
  });

  it("translates generic DB error to friendly message (never exposes internal details)", async () => {
    const insertSpy = vi.fn().mockReturnValue(
      makeChain({
        data: null,
        error: { code: "XX000", message: "internal db error details users must not see" },
      }),
    );
    const chain = makeChain({
      data: null,
      error: { code: "XX000", message: "internal db error details users must not see" },
    });
    chain.insert = insertSpy;
    mockSupabase.from.mockReturnValue(chain);

    await expect(
      createHandler({
        data: { name: "Test", lat: 38.9, lng: -77.0 },
        context: { userId: USER_A_ID },
      }),
    ).rejects.toThrow("Something went wrong. Please try again.");
  });
});

// ── updateUserSite ─────────────────────────────────────────────────────────────
describe("updateUserSite", () => {
  it("returns the updated site row on success", async () => {
    const siteRow = { id: SITE_ID, name: "New Name", owner_id: USER_A_ID };
    mockSupabase.from.mockReturnValue(makeChain({ data: siteRow, error: null }));

    const result = await updateHandler({
      data: { siteId: SITE_ID, name: "New Name" },
      context: { userId: USER_A_ID },
    });

    expect(result).toEqual(siteRow);
  });

  it("throws friendly message when no row matches (wrong owner or wrong id)", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    await expect(
      updateHandler({
        data: { siteId: SITE_ID, name: "New Name" },
        context: { userId: USER_B_ID },
      }),
    ).rejects.toThrow("You can only change your own spots.");
  });

  it("user B cannot rename user A's site — friendly message returned", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    await expect(
      updateHandler({
        data: { siteId: SITE_ID, name: "Hijacked Name" },
        context: { userId: USER_B_ID },
      }),
    ).rejects.toThrow("You can only change your own spots.");
  });

  it("translates generic DB error to friendly message", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ data: null, error: { code: "XX000", message: "internal db error details" } }),
    );

    await expect(
      updateHandler({
        data: { siteId: SITE_ID, name: "Any Name" },
        context: { userId: USER_A_ID },
      }),
    ).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("translates duplicate-key-value message (no 23505 code) to a friendly message", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({
        data: null,
        error: { code: "UNIQUE", message: "duplicate key value violates unique constraint" },
      }),
    );

    await expect(
      updateHandler({
        data: { siteId: SITE_ID, name: "Any Name" },
        context: { userId: USER_A_ID },
      }),
    ).rejects.toThrow("You already have a spot with that exact name and location.");
  });

  it("queries the sites table", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: { id: SITE_ID }, error: null }));

    await updateHandler({
      data: { siteId: SITE_ID, name: "Name" },
      context: { userId: USER_A_ID },
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("sites");
  });
});

// ── deleteUserSite ─────────────────────────────────────────────────────────────
describe("deleteUserSite", () => {
  it("returns ok:true on success", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await deleteHandler({
      data: { siteId: SITE_ID },
      context: { userId: USER_A_ID },
    });

    expect(result).toEqual({ ok: true });
  });

  it("queries the sites table", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    await deleteHandler({ data: { siteId: SITE_ID }, context: { userId: USER_A_ID } });

    expect(mockSupabase.from).toHaveBeenCalledWith("sites");
  });

  it("user B cannot delete user A's site — owner_id filter makes it a safe no-op", async () => {
    // DELETE ... WHERE owner_id = USER_B_ID finds no rows for USER_A's site.
    // Security enforced by the SQL filter; function returns ok without error.
    mockSupabase.from.mockReturnValue(makeChain({ error: null }));

    const result = await deleteHandler({
      data: { siteId: SITE_ID },
      context: { userId: USER_B_ID },
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.from).toHaveBeenCalledWith("sites");
  });

  it("translates DB error to friendly message", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ error: { code: "XX000", message: "some internal db error" } }),
    );

    await expect(
      deleteHandler({ data: { siteId: SITE_ID }, context: { userId: USER_A_ID } }),
    ).rejects.toThrow("Something went wrong. Please try again.");
  });
});

// ── listUserSites ──────────────────────────────────────────────────────────────
describe("listUserSites", () => {
  const PERSONAL_SITE = {
    id: SITE_ID,
    slug: "trial-aaaabbbb",
    name: "Trial",
    description: null,
    lat: 38.9,
    lng: -77.0,
    owner_id: USER_A_ID,
  };

  it("returns the owner's personal sites", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: [PERSONAL_SITE], error: null }));

    const result = await listHandler({ context: { userId: USER_A_ID } });

    expect(result).toEqual([PERSONAL_SITE]);
    expect(mockSupabase.from).toHaveBeenCalledWith("sites");
  });

  it("returns empty array when the user has no personal sites", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));

    const result = await listHandler({ context: { userId: USER_B_ID } });

    expect(result).toEqual([]);
  });

  it("returns empty array when DB returns null data", async () => {
    mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await listHandler({ context: { userId: USER_A_ID } });

    expect(result).toEqual([]);
  });

  it("translates DB error to friendly message", async () => {
    mockSupabase.from.mockReturnValue(
      makeChain({ error: { code: "XX000", message: "some internal db error" } }),
    );

    await expect(listHandler({ context: { userId: USER_A_ID } })).rejects.toThrow(
      "Something went wrong. Please try again.",
    );
  });
});
