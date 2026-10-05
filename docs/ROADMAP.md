# Roadmap

Pending work items in priority order. All require delivery via Lovable prompts (not GitHub PRs) unless otherwise noted. See `docs/LOVABLE_WORKFLOW.md` for the split-prompt strategy.

---

## 1. Layout Polish — Bottom Tab Bar Overlap

**What:** Several elements (bottom sheet CTAs, river detail page footer, tides page nav) are hidden behind the bottom tab bar on mobile. This is the most visible breakage in the live app.

**Delivery:** Lovable layout polish prompt. Check every page at 390px width after each round.

**Acceptance:** No CTA button, card, or text overlaps the bottom tab bar on any page.

---

## 2. Activate AI Explanations (`ANTHROPIC_API_KEY`)

**What:** The "Ask WaterVoice AI" button in `SiteBottomSheet` is wired up but the key is missing from Lovable Secrets. Adding it will activate streaming AI explanations for every site.

**Delivery:** Add `ANTHROPIC_API_KEY` to Lovable → Project Settings → Secrets. No code change needed.

**Note:** Model is currently `claude-sonnet-4-5`. Consider upgrading to `claude-sonnet-4-6` for improved quality. Change is in `src/routes/api/explain.ts`.

---

## 3. Water Quality Data Sources

**What:** The core water-quality use case (PASS/CAUTION/UNSAFE verdicts) needs live bacteria readings. Current sources are USGS WQP, Arlington County CSV, and NOAA rain data. Need to add:
- DOEE (DC Dept of Energy & Environment) real-time monitoring stations
- DC Health advisory feeds (CSO overflow notifications)
- Potential: MD DNR water quality sampling results

**Delivery:** Multi-prompt Lovable sequence: schema prompt → adapter prompt → UI prompt.

---

## 4. Rivers Page Enrichment

**What:** `/rivers` lists all 171 non-tidal gauges as a flat list. Planned improvements:
- Show current stage and trend alongside gauge name
- Filter/group by state (MD / VA / DC)
- Show "No data" badge for gauges without recent readings
- Search/filter by name or USGS site number

**Delivery:** Lovable prompt after layout polish is complete. Separate prompts for data layer vs. filter UI.

---

## 5. Columbia Island Marina Manual INSERT

**What:** Columbia Island Marina is a high-priority site (tidal, DC waters, near Memorial Bridge) that is not in any automated data source. Needs a manual INSERT into `sites` with appropriate `lat`, `lng`, `site_type = 'marina'`, `water_body_type = 'tidal_brackish'`, `is_tidal = true`, `tidal_gauge_station_id`.

**Delivery:** Claude Code script or direct Supabase SQL. Not a Lovable task.

**Prerequisites:** Confirm correct tidal station (likely 8594900 — Washington DC at Key Bridge).

---

## 6. Nearby Gauge Override UI

**What:** Every site has `nearest_gauge_id` auto-assigned by proximity. Some assignments are wrong (e.g. a tidal site matched to an upstream freshwater gauge). Need an admin UI or script to manually override `nearest_gauge_id` for specific sites.

**Delivery:** Claude Code script (`scripts/overrideGaugeAssignment.ts`) or a Supabase function call. No Lovable UI needed in the short term.

---

## 7. Tidal Chart — Site-Specific `min_navigable_ft`

**What:** The `/tides` tidal curve chart shows a horizontal "navigable" threshold line. Currently it is hardcoded per water body (Potomac vs. Anacostia). It should instead read `sites.min_navigable_ft` for the selected site when a site context is set.

**Delivery:** Lovable prompt targeting `src/routes/tides.tsx`. Pass `min_navigable_ft` from the selected site into the chart; fall back to the current hardcoded default when null.

**Prerequisite:** `min_navigable_ft` must be populated for at least a few tidal sites in the DB.
