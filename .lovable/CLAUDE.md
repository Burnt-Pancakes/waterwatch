# WaterVoice DMV — Claude Code Context

## Project
Civic water quality advisory app for DC Metro area.
App name in Lovable: DC Water Watch.
GitHub repo: dc-water-watch.
TanStack Start + Vite + Lovable Cloud (Supabase backend).
MapLibre GL JS + OpenFreeMap tiles (no API key needed).
Resend email. Vitest + Playwright tests.

## Critical rules
1. Map is fully public — no auth to view water quality
2. Auth gates only favorites, alerts, account management
3. All browser-only code must be in useEffect or guarded 
   by typeof window !== 'undefined' (SSR requirement)
4. Supabase default secure storage + RLS as trust boundary
5. RLS on every table — never bypass
6. JSDoc on every function explaining purpose and params
7. Inline comments on complex logic explaining WHY
8. Vitest unit tests alongside every module — 90% coverage
9. Mobile-first, verified at 390px width
10. Dark mode via Tailwind dark: prefix

## Key files already built
- src/lib/waterQualityEngine.ts — EPA decision engine
- src/lib/seed/fourMileRunSites.ts — 17 seed locations
- src/types/watervoice.types.ts — WaterStatus, StatusConfig
- src/types/database.types.ts — Supabase generated types
- src/components/map/WaterVoiceMap.tsx — MapLibre map
- src/components/map/SiteBottomSheet.tsx — site detail sheet
- src/lib/adapters/ — USGS, Arlington County, NOAA, OSM adapters

## What is already working
- Full screen map rendering with OpenFreeMap Liberty tiles
- 4 active Four Mile Run seed sites on the map
- 13 inactive expansion sites in the database
- Marker clustering, filter pills (All/Kayak/Boat Ramp etc)
- Bottom sheet slides up on marker click showing site detail
- Status badge (PASS/CAUTION/UNSAFE/NO DATA)
- Stale data blue banner
- Rain advisory amber banner
- Favorite star button
- Rachel's legal disclaimer on every site card
- Auth flow (sign up, sign in, reset password, verify email)
- Decision engine with 44 passing tests
- Database schema with 6 tables and RLS on all
- 7 data source adapters (USGS WQP active, Arlington CSV active, NOAA active, OSM active; OpenDataDC/MD DNR/VA DWR implemented but disabled pending endpoint verification)
- PWA manifest + install prompt + splash screen
- BottomTabBar (Map/List/Favorites/Account)
- AI explanation streaming endpoint (claude-sonnet-4-5)
- Guest alert subscription + unsubscribe flow
- 443 tests passing across 51 test files (90%+ coverage enforced by CI)
- 11 database migrations
- Full CI pipeline (lint, unit tests with coverage, E2E on PRs)

## Status colors
- PASS:    color #3B6D11  bg #EAF3DE  border #3B6D11
- CAUTION: color #BA7517  bg #FAEEDA  border #BA7517
- UNSAFE:  color #E24B4A  bg #FCEBEB  border #E24B4A
- NO DATA: color #888780  bg #F1EFE8  border #888780
- STALE:   blue #185FA5 banner overlay (not a status)
- RAIN:    amber #BA7517 banner overlay (not a status)

## EPA thresholds (from waterQualityEngine.ts)
Freshwater E. coli:
  PASS ≤ 235 MPN/100mL
  CAUTION 236-410 MPN/100mL
  UNSAFE > 410 MPN/100mL
Tidal/brackish Enterococci:
  PASS ≤ 35 CCE/100mL
  CAUTION 36-130 CCE/100mL
  UNSAFE > 130 CCE/100mL
Stale threshold: 7 days
Rain advisory threshold: 1.0 inch in 48 hours

## Legal disclaimers (always include on water quality display)
siteCard: "Advisory only. Not a regulatory determination. 
  Conditions change rapidly after rain events."
aiExplanation: "Based on {source} data from {date} using 
  EPA 2012 RWQC guidelines. Not a regulatory determination."
rainAdvisory: "Heavy rainfall in the past 48 hours may have 
  elevated bacteria levels beyond the most recent reading."
staleData: "This reading is {days} days old. Water quality 
  can change rapidly."
footer: "Data: USGS, EPA WQP, Arlington County DES, Swim Guide.
  Standards: EPA 2012 RWQC, VA DEQ. Not a regulatory authority."

## Test counts (all passing as of last Lovable session)
- Decision engine: 44 tests
- Database schema: 14 tests  
- Ingestion pipeline: 47 tests
- Map + bottom sheet: 12 tests
- Total: 117 tests passing (note: full suite now runs 443 tests across 51 test files as of latest CI run)

## Environment variables (in Lovable Cloud Secrets)
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
VITE_SITE_URL
VITE_MAP_TILE_URL = https://tiles.openfreemap.org/styles/liberty
VITE_MAP_TILE_URL_DARK = https://tiles.openfreemap.org/styles/liberty-dark
ANTHROPIC_API_KEY
CRON_SECRET