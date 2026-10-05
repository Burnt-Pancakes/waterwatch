# Lovable Workflow

WaterVoice DMV is developed using [Lovable](https://lovable.dev), an AI-assisted builder that generates React code, manages the Supabase project, and deploys the app. This document explains how to work with Lovable safely and efficiently.

---

## The Golden Rule: `main` Is the Lovable Sync Boundary

The connected repository uses two-way Git sync. Lovable changes are committed
to GitHub, and changes merged to the default branch sync back to Lovable.
Feature branches remain isolated until they are selected in Lovable or merged
to `main`. Always update from `origin/main` before starting work and never
assume an unmerged PR is deployed.

**What to build where:**

| In Claude Code                   | In Lovable                           |
| -------------------------------- | ------------------------------------ |
| Seed scripts, one-off migrations | New pages and routes                 |
| Adapter logic + unit tests       | Schema changes (add columns, tables) |
| Edge function reference copies   | Component styling and layout polish  |
| CI configuration                 | Auth flows, user preferences         |
| Documentation                    | Supabase Edge Function deployments   |

---

## Credit Costs and Prompt Splitting

Lovable bills by "credits" (AI compute time). A single prompt that tries to do too much will:

1. Cost 3–5 credits
2. Often produce incomplete or broken output
3. Leave layout breakage that requires another prompt to fix

**Rule of thumb:** One concern per prompt.

**Split complex features like this:**

```
Prompt 1 (Schema): Add column X to table Y. No UI changes.
Prompt 2 (Logic): Wire up the new column in component Z. No layout changes.
Prompt 3 (Polish): Fix spacing, ensure nothing overlaps the bottom tab bar.
```

---

## Layout Polish Always Follows Feature Additions

Lovable features consistently cause one or more of:

- Content hidden behind the bottom tab bar (84px height)
- Cards or buttons clipped at the bottom of the screen
- New pages missing padding-bottom

**After every feature addition**, follow up with a layout polish prompt:

> "Check every page at 390px width. Ensure no content is hidden behind the bottom tab bar. Add `pb-24` or equivalent bottom padding where needed."

---

## Backend and Edge Functions

Backend code and safe database migrations should be committed with the feature
so Lovable can publish one reviewed version. Avoid release designs that require
an operator to discover the underlying managed Supabase project, upload private
artifacts, or copy secrets by hand.

Scenic routing deliberately uses a same-origin TanStack server API and static
versioned assets. It does not require a Supabase Edge Function deployment.

---

## Secrets and Environment Variables

Production secrets are managed in **Lovable → Project Settings → Secrets**. Do NOT commit secrets to `.env` or push them to GitHub.

| Secret                      | Purpose                              | Status                                     |
| --------------------------- | ------------------------------------ | ------------------------------------------ |
| `SUPABASE_URL`              | Supabase project URL                 | ✅ Set                                     |
| `SUPABASE_ANON_KEY`         | Public Supabase key                  | ✅ Set                                     |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin Supabase key (server only)     | ✅ Set                                     |
| `CRON_SECRET`               | Auth header for `/api/public/ingest` | ✅ Set                                     |
| `RESEND_API_KEY`            | Email via Resend                     | ✅ Set                                     |
| `ANTHROPIC_API_KEY`         | Claude AI explanations               | ⚠️ **Missing** — add to activate AI button |

---

## Database Schema Changes

When you need to add a column or table:

1. Add a timestamped, idempotent SQL migration under `supabase/migrations/`.
2. Regenerate `src/integrations/supabase/types.ts` when table or RPC signatures change.
3. Validate the migration locally and in preview before publishing.
4. Keep data artifacts outside migrations when they can ship as immutable app
   assets; Lovable Test/Live publishing synchronizes safe structure, not
   environment-specific database contents.

---

## Sync Order

The correct sequence for a feature that involves both Lovable and Claude Code:

```
1. Build schema in Lovable (if needed)
2. git pull origin main
3. Build scripts/adapters/tests in Claude Code
4. Open and review a PR
5. Merge to `main` so Lovable receives the reviewed commit
6. Publish through Lovable and run the live smoke tests
```

---

## What Happens When You Push a GitHub Change

Feature-branch pushes run CI and preview deployment. Changes merged to the
default branch synchronize to Lovable; publishing promotes the reviewed
application code and safe database structure.

For files Lovable manages (routes, components, types.ts), Claude Code changes that Lovable then re-generates will be lost. Keep Claude Code changes in files Lovable does not touch: `src/lib/`, `src/lib/adapters/`, `scripts/`, `tests/`, `docs/`, CI config.
