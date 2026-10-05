# Project Memory

## Core
WaterVoice-DMV: public water quality advisory app for DC Metro using EPA 2012 Recreational Water Quality Criteria.
Stack: TanStack Start+Vite, Lovable Cloud (Supabase), Tailwind, MapLibre GL + OpenFreeMap (no key), Resend, Vitest+Playwright.
Map is fully public — no auth to view data. Auth gates ONLY favorites, alerts, account management.
Always validate session server-side via requireSupabaseAuth in createServerFn — never client-only route guards.
RLS enabled on every table. Auth storage: Supabase default secure storage + RLS as trust boundary.
Every function needs JSDoc (purpose + params). Complex logic needs inline comments explaining WHY.
Vitest unit tests alongside every module — target 90% coverage.
Mobile-first, tested at 390px. Dark mode from day one via Tailwind `dark:`.
Primary navigation/actions must be explicit and discoverable; avoid icon-only links when text fits.

## Memories
