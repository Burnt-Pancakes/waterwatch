# API Routes

All routes are implemented as TanStack Start file-based server handlers. Rate limiting uses the `auth_rate_limits` table (service role). Rate limit headers are included on all responses.

---

## `GET /api/sites`

Returns all active sites as a GeoJSON FeatureCollection. Cached for 1 hour (`Cache-Control: public, max-age=3600`).

**Rate limit:** `api_sites` bucket (default limits)

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `lat` | number | No | User latitude. Must be paired with `lng`. |
| `lng` | number | No | User longitude. Must be paired with `lat`. |
| `radius_km` | number | No | Filter sites within this radius. Requires `lat` + `lng`. |
| `site_type` | string | No | Filter by site type (e.g. `kayak_launch`, `boat_ramp`). |

**Behavior:**
- With `lat`/`lng`: calls the `get_sites_with_latest_reading` Postgres function. Results are sorted by `distance_km` ascending.
- Without `lat`/`lng`: queries `sites` directly then fetches latest reading per site.
- Status and staleness are computed server-side using `getWaterStatus` and `isStaleReading`.

**Response (200):**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-77.055, 38.840] },
      "properties": {
        "id": "uuid",
        "slug": "four-mile-run-kayak-launch-ada",
        "name": "Four Mile Run Kayak Launch (ADA)",
        "site_type": "kayak_launch",
        "water_body_type": "freshwater",
        "ada_accessible": true,
        "status": "pass",
        "isStale": false,
        "stale": false,
        "e_coli_mpn": 120,
        "enterococci_cce": null,
        "sampled_at": "2026-05-28T14:00:00Z",
        "data_source": "usgs_wqp",
        "distance_km": 0.3
      }
    }
  ]
}
```

**Error responses:** 400 (invalid params), 429 (rate limit), 500 (database error)

---

## `GET /api/sites/:slug`

Returns site detail plus the most recent reading and any active rain advisory. Cached for 30 minutes (`Cache-Control: public, max-age=1800`).

**Rate limit:** `api_sites_detail` bucket

**Path parameter:** `slug` — the site's URL-safe slug (e.g. `four-mile-run-kayak-launch-ada`)

**Response (200):**
```json
{
  "site": {
    "id": "uuid",
    "slug": "four-mile-run-kayak-launch-ada",
    "name": "Four Mile Run Kayak Launch (ADA)",
    "site_type": "kayak_launch",
    "water_body_type": "freshwater",
    "lat": 38.84044,
    "lng": -77.05552,
    "address": null,
    "description": "ADA-accessible kayak launch on Four Mile Run...",
    "amenities": ["parking", "ada_ramp"],
    "parking_notes": null,
    "ada_accessible": true,
    "data_source_ids": [],
    "is_active": true
  },
  "latest": {
    "id": "uuid",
    "sampled_at": "2026-05-28T14:00:00Z",
    "e_coli_mpn": 120,
    "enterococci_cce": null,
    "sample_method": null,
    "data_source": "usgs_wqp",
    "source_url": "https://www.waterqualitydata.us/...",
    "status": "pass"
  },
  "status": "pass",
  "isStale": false,
  "activeRainAdvisory": null
}
```

`activeRainAdvisory` is the most recent `rain_events` row with `advisory_active = true`, or `null` if no advisory is active.

**Error responses:** 400 (missing slug), 404 (site not found), 429, 500

---

## `GET /api/sites/:slug/readings`

Returns historical readings for a site plus a geometric mean for the most recent 30-day window. Cached for 30 minutes.

**Rate limit:** `api_sites_readings` bucket

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | integer 1–365 | 90 | How many days of history to return |

**Response (200):**
```json
{
  "readings": [
    {
      "id": "uuid",
      "site_id": "uuid",
      "sampled_at": "2026-05-28T14:00:00Z",
      "e_coli_mpn": 120,
      "enterococci_cce": null,
      "sample_method": null,
      "data_source": "usgs_wqp",
      "source_url": "...",
      "status": "pass"
    }
  ],
  "geometricMean": 85.4
}
```

`geometricMean` is `null` when fewer than 5 readings are available in the last 30 days.

---

## `POST /api/explain`

Streams an AI explanation of a water quality reading for a specific activity. Uses Server-Sent Events (SSE). Rate limit: 10 requests per IP per hour.

**Rate limit:** `api_explain` bucket — 10 req / 3600 sec per IP

**Request body:**
```json
{
  "siteName": "Four Mile Run Kayak Launch (ADA)",
  "status": "caution",
  "eColiMpn": 280,
  "enterococciCce": null,
  "waterBodyType": "freshwater",
  "sampledAt": "2026-05-28T14:00:00Z",
  "dataSource": "usgs_wqp",
  "activity": "kayaking",
  "recentRainInches": 0.2
}
```

`status` must be one of: `pass`, `caution`, `unsafe`, `stale`, `no_data`
`activity` must be one of: `swimming`, `kayaking`, `wading`, `fishing`

**Response (200):** `Content-Type: text/event-stream`

```
data: {"text":"Bacteria levels are elevated"}

data: {"text":" above the EPA pass threshold."}

data: [DONE]
```

**AI model used:** `claude-sonnet-4-5` with `max_tokens: 200`, `temperature: 0.3`

**System prompt rules (not returned to client):** 3-4 sentences max, 6th grade reading level, no "100% safe" claims, always reference EPA 2012 RWQC, end with "This is advisory only, not a regulatory determination."

**Error responses:** 400 (invalid body), 429 (rate limit), 503 (ANTHROPIC_API_KEY not configured)

---

## `POST /api/public/ingest`

Triggers the data ingestion pipeline. Called by Supabase `pg_cron` on a schedule. Requires a `CRON_SECRET` bearer token (constant-time comparison).

**Authentication:** `Authorization: Bearer <CRON_SECRET>`

**Request body (optional):**
```json
{ "sourceId": "noaa_rain" }
```

Omit `sourceId` to run all adapters.

**Response (200):**
```json
{
  "sourcesRun": ["usgs_wqp", "arlington_county", "noaa_rain", "osm_poi", "opendatadc", "mddnr", "vadwr"],
  "readingsInserted": 42,
  "readingsSkipped": 3,
  "errors": []
}
```

**Error responses:** 401 (missing or wrong secret), 400 (invalid JSON body), 500 (CRON_SECRET not configured on server)

---

## `POST /api/guest-alert`

Subscribes a guest (unauthenticated) email address to water quality alerts for a site. Rate limit: 10 requests per IP per hour. Sends a confirmation email via Resend.

**Rate limit:** `api_guest_alert` bucket — 10 req / 3600 sec per IP

**Request body:**
```json
{
  "email": "user@example.com",
  "siteId": "uuid"
}
```

**Response (201):**
```json
{ "ok": true }
```

If the `(email, site_id)` pair already exists, the row is upserted silently (no error). A confirmation email with an unsubscribe link is sent regardless.

**Error responses:** 400 (invalid body), 404 (site not found or inactive), 429, 500

---

## `GET /api/guest-alert/unsubscribe`

One-click unsubscribe for guest alert emails. Returns an HTML page (not JSON).

**Query parameter:** `token` — the UUID token from the guest alert row

**Response (200):** HTML page confirming unsubscription or showing an error message.

Deletes the `guest_alerts` row where `token` matches.
