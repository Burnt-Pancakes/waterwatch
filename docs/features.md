# Features

User-facing features in WaterWatch, one entry per feature. Status: **Live** = working in production; **Built / unwired** = code exists but requires a missing secret or config; **Planned** = roadmap item.

---

## Interactive Map

**Status:** Live | **Route:** `/` | **Code:** `src/components/map/WaterVoiceMap.tsx`

Full-screen MapLibre GL map centered on DC (`[-77.0369, 38.9072]`). Tiles from OpenFreeMap Liberty (no API key). Auto-switches to dark tile style via `prefers-color-scheme`.

Each active site renders as a colored circle marker:
- **Green** — most recent reading is PASS and not stale
- **Yellow** — most recent reading is CAUTION
- **Red** — most recent reading is UNSAFE
- **Blue** (ring) — stale reading (> 7 days old)
- **Grey** — no bacteria reading yet

Sites with > 50 visible are Supercluster-clustered into bubble counts. Tapping a cluster zooms in; tapping a single marker opens the Site Bottom Sheet.

A horizontally-scrollable **filter bar** (`FilterBar.tsx`) lets users narrow to a site type: all, kayak launch, boat ramp, beach, swim area, marina.

---

## Site Bottom Sheet

**Status:** Live | **Trigger:** tap any map marker | **Code:** `src/components/map/SiteBottomSheet.tsx`

Mobile-native slide-up panel with drag-to-dismiss. Shows:

- **Status badge** — PASS / CAUTION / UNSAFE / NO DATA with color and icon
- **Stale data banner** (blue) — reading is older than 7 days
- **Rain advisory banner** (amber) — 1.0+ inches of rain in past 48 hours
- **Activity advisories** — per-activity (swimming, kayaking, wading, fishing) guidance derived from EPA thresholds
- **30-day readings chart** — `recharts` LineChart with reference lines at EPA thresholds (235 and 410 MPN)
- **River stage card** (`RiverStage.tsx`) — current stage, flow, trend from `gauge_readings` via `nearest_gauge_id`; only shown when a gauge is linked
- **Weather card** — NWS hourly forecast from `weather_readings`
- **AI explanation panel** (`AIExplanation.tsx`) — "Explain this reading" button; streams from `/api/explain` (see Built / unwired below)
- **Alert configuration** — authenticated users can configure which statuses trigger email alerts
- **Guest alert form** — unauthenticated users can subscribe by email
- **Share button** — Web Share API or clipboard fallback

---

## Site Detail Page

**Status:** Live | **Route:** `/sites/:slug` | **Code:** `src/routes/sites/$slug.tsx`

Full-page detail for a site. Shows:
- Status badge and site metadata (type, address, amenities)
- Full readings history table (90-day window, paginated)
- Rain advisory from latest `rain_events` row
- Legal disclaimer

No river gauge card or weather card — these live only in the bottom sheet. Personal site owners see a delete button.

---

## List View

**Status:** Live | **Route:** `/list` | **Code:** `src/routes/list.tsx`

Flat list of all active sites, each showing name, type, and current status badge. Sorted by distance when geolocation is granted, otherwise alphabetical. Tapping a row opens the Site Bottom Sheet (not the detail page).

---

## Rivers Index

**Status:** Live | **Route:** `/rivers` | **Code:** `src/routes/rivers.index.tsx`

Lists all 171 non-tidal USGS gauges with current stage and trend. Links to River Detail for each gauge.

---

## River Detail

**Status:** Live | **Route:** `/rivers/:gaugeId` | **Code:** `src/routes/rivers.$gaugeId.tsx`

Per-gauge page showing:
- Current stage (ft), flow (cfs), trend indicator
- 7-day stage history chart (`recharts` LineChart)
- Stage thresholds (too low / optimal / caution) from `stage_thresholds` table
- List of paddle sites linked to this gauge via `nearest_gauge_id`

---

## Tides & Trip Planning

**Status:** Live | **Route:** `/tides` | **Code:** `src/routes/tides.tsx`

Tidal site planning view powered by pre-fetched NOAA predictions. Shows:
- 48-hour tidal curve chart (cosine-interpolated between H/L predictions)
- Next high and low tides with times and heights (MLLW)
- Site navigability badges — each tidal site is labeled navigable/marginal/unnavigable based on current tide vs. `sites.min_navigable_ft`

> **Known limitation:** `min_navigable_ft` defaults to hardcoded per-water-body values (Potomac vs. Anacostia) until populated per-site in the DB. See Roadmap item 7.

---

## Auth

**Status:** Live | **Routes:** `/auth/*` | **Code:** `src/routes/auth/`

Email/password and magic-link (passwordless) authentication via Supabase Auth.

| Route | Purpose |
|---|---|
| `/auth/sign-in` | Email + password login; magic-link option |
| `/auth/sign-up` | New account registration |
| `/auth/verify-email` | Post-signup email verification prompt |
| `/auth/callback` | OAuth/magic-link redirect handler |
| `/auth/reset-password` | Forgot password — sends reset email via Supabase |
| `/auth/update-password` | Set new password (reached via reset email link) |

Auth gates: Favorites, Alerts, Account. The map and all water quality data are public — no account needed.

---

## Favorites

**Status:** Live | **Route:** `/favorites` | **Auth:** Required | **Code:** `src/routes/_authenticated/favorites.tsx`

User bookmarks for sites. Stored in the `favorites` table. Each favorited site shows its current status badge. Tapping navigates to the map with that site's bottom sheet open. The BottomTabBar favorites tab shows a count badge (capped at "9+").

---

## Alerts

**Status:** Live | **Route:** `/alerts` | **Auth:** Required for configuration | **Code:** `src/routes/_authenticated/alerts.tsx`

Email notifications when a site's bacteria status changes.

**Authenticated alerts:** Users configure which statuses trigger email (`alerts` table). They can set alerts for multiple sites with per-site threshold selection (e.g. notify on CAUTION or UNSAFE).

**Guest alerts:** Unauthenticated users can enter an email in the Site Bottom Sheet (`GuestAlertForm.tsx`) to subscribe to status change notifications for a single site (`guest_alerts` table, service-role only).

Emails are sent via Resend by the `send-alerts` edge function, triggered by a Postgres DB trigger on `readings` INSERT.

---

## Account

**Status:** Live | **Route:** `/account` | **Auth:** Required | **Code:** `src/routes/_authenticated/account.tsx`

Manage profile (`display_name`, email alert toggle), view active alerts, sign out. Password change available for email/password accounts.

---

## My Spots (Personal Sites)

**Status:** Live | **Access:** Auth required | **Code:** `src/lib/userSites.functions.ts`, `src/components/map/MySpotsList.tsx`

Users can add, name, and delete their own paddle spots. Personal spots appear on the map as standard markers and are managed through a "My spots" panel accessible from the map.

Flow:
1. User opens "My spots" → taps "Add a spot"
2. Map enters placement mode — user taps the map to drop a pin
3. A form collects name, description, site type, water body type
4. The site is created in the `sites` table with `status = 'personal'` and `owner_id = user.id`
5. The site appears on the map immediately (re-fetch on auth state change)
6. Delete button visible only to the owner (identified via `personalSiteIds` set, not the `get_sites_with_latest_reading` RPC which omits `owner_id`)

Personal sites receive bacteria data automatically once `site_station_assignments` rows exist for them and a nearby monitoring station is sampled.

---

## Water Temperature

**Status:** Built / unwired | **Trigger:** Site Bottom Sheet | **Code:** `supabase/functions/fetch-water-conditions/index.ts`, `supabase/migrations/20260828120000_nearest_water_temp_fn.sql`

Water temperature from USGS gauges and CBIBS Bay buoys, displayed alongside river stage in the Site Bottom Sheet.

**Data pipeline:**
- `fetch-water-conditions` edge function runs hourly (`:05` past each hour) and upserts USGS and CBIBS readings into `water_temp_observations`.
- `nearest_water_temp(lat, lng, max_km DEFAULT 30.0)` SQL function finds the closest reading within 6 hours using a bounding-box prefilter + Haversine order.

**Deployment status:** `nearest_water_temp` is live (applied by Lovable migration `20260903025450`). `fetch-water-conditions` runs hourly and data is accumulating in `water_temp_observations`. UI wiring to the Site Bottom Sheet is the remaining step.

**Display rules:**
- Always stored in Celsius; displayed in °F.
- Never use the word "safe" — lowest band is "Lower risk."
- Reading age shown alongside value; no reading = no card.
- All user-facing strings live in a `content.ts`; thresholds live in a single shared constant.

---

## AI Water Quality Explanation

**Status:** Built / unwired | **Trigger:** "Explain this reading" in Site Bottom Sheet | **Code:** `src/routes/api/explain.ts`, `src/components/site/AIExplanation.tsx`

Streams an AI-generated plain-language explanation of a site's water quality reading via Server-Sent Events from `/api/explain`. Uses Anthropic Claude (`claude-sonnet-4-5`).

**To activate:** Add `ANTHROPIC_API_KEY` to Lovable → Project Settings → Secrets. No code change needed.

Every AI response ends with: "This is advisory only, not a regulatory determination." The system prompt hard-codes this requirement.

---

## PWA (Progressive Web App)

**Status:** Live | **Code:** `public/manifest.json`, `src/components/ui/InstallPrompt.tsx`

The app ships as a PWA:
- Installable to home screen on iOS and Android
- `InstallPrompt.tsx` triggers the native add-to-home-screen dialog after the user's 3rd visit (tracked in `localStorage`)
- `FirstUseDisclaimer.tsx` shows a full-screen safety disclaimer on first launch (acceptance stored in `localStorage`)

---

## First-Use Disclaimer

**Status:** Live | **Code:** `src/components/ui/FirstUseDisclaimer.tsx`

Shown once per browser on first visit. Displays the safety disclaimer from `DISCLAIMERS.firstUse` in `waterQualityEngine.ts`. Requires the user to tap "I understand" before dismissing. Acceptance stored in `localStorage` under `watervoice_disclaimer_accepted`.
