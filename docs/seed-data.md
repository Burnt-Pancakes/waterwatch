# Seed Data

**File:** `src/lib/seed/fourMileRunSites.ts`

17 seed sites used to bootstrap a fresh database in development. Coordinates are hand-verified against OpenStreetMap. Re-running the seed is idempotent — the seed route uses `upsert` on the unique `slug` column.

4 sites are `is_active: true` (visible on the map). 13 sites are `is_active: false` (expansion sites not yet active).

---

## Active Sites (4)

| Name | Slug | Type | Water Body | ADA | Amenities |
|---|---|---|---|---|---|
| Four Mile Run Kayak Launch (ADA) | `four-mile-run-kayak-launch-ada` | `kayak_launch` | freshwater | Yes | parking, ada_ramp |
| Commonwealth Ave Ramp | `commonwealth-ave-ramp` | `kayak_launch` | freshwater | No | street_parking |
| Washington Sailing Marina | `washington-sailing-marina` | `marina` | tidal_brackish | No | parking, restrooms, rentals, food |
| Four Mile Run / Potomac Confluence | `four-mile-run-potomac-confluence` | `swim_area` | tidal_brackish | No | (none) |

---

## Inactive Expansion Sites (13)

| Name | Slug | Type | Water Body | Address |
|---|---|---|---|---|
| Gravelly Point Boat Ramp | `gravelly-point-boat-ramp` | `boat_ramp` | tidal_brackish | 12 Mt Vernon Trail, Arlington, VA 22202 |
| Anacostia Park Boat Ramp | `anacostia-park-boat-ramp` | `boat_ramp` | tidal_brackish | 1500 Anacostia Dr NE, Washington, DC 20020 |
| James Creek Marina | `james-creek-marina` | `marina` | tidal_brackish | 200 V St SW, Washington, DC 20024 |
| Belle Haven Marina | `belle-haven-marina` | `marina` | tidal_brackish | 1 Belle Haven Rd, Alexandria, VA 22307 |
| Pohick Bay Regional Boat Ramp | `pohick-bay-boat-ramp` | `boat_ramp` | tidal_brackish | 6501 Pohick Bay Dr, Lorton, VA 22079 |
| Pohick Bay Kayak Launch | `pohick-bay-kayak-launch` | `kayak_launch` | tidal_brackish | Lorton, VA 22079 |
| Fountainhead Regional Park Boat Launch | `fountainhead-boat-launch` | `boat_ramp` | freshwater | Fairfax Station, VA 22039 |
| Algonkian Regional Park Boat Ramp | `algonkian-boat-ramp` | `boat_ramp` | freshwater | 47001 Fairway Dr, Sterling, VA 20165 |
| River Bend Park Boat Ramp | `river-bend-boat-ramp` | `boat_ramp` | freshwater | 8700 Potomac Hills St, Great Falls, VA 22066 |
| Bladensburg Waterfront Park | `bladensburg-waterfront` | `kayak_launch` | freshwater | 4601 Annapolis Rd, Bladensburg, MD 20710 |
| Key Bridge Boathouse | `key-bridge-boathouse` | `kayak_launch` | tidal_brackish | 3500 Water St NW, Washington, DC 20007 |
| Thompson Boat Center | `thompson-boat-center` | `kayak_launch` | tidal_brackish | 2900 Virginia Ave NW, Washington, DC 20037 |
| Fletcher's Cove Boathouse | `fletchers-cove` | `kayak_launch` | freshwater | 4940 Canal Rd NW, Washington, DC 20016 |

---

## Notes

- `is_active: false` sites exist in the database but are filtered out by all API queries and the map. They are placeholders for future data partnerships.
- To activate a site, set `is_active = true` in the database (or update the seed file and re-seed).
- To add new sites permanently, add them to `fourMileRunSites.ts` and run the seed route. Or upsert directly via the Supabase dashboard.
- The proof-of-concept focus area is Four Mile Run / lower Potomac (Arlington, VA), built in partnership with the Four Mile Run Conservancy.
