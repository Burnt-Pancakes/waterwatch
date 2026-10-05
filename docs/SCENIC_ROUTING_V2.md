# Scenic Routing V2

## Safety contract

`POST /api/route-v2` returns only graph paths whose edges are consecutive nodes
from one OSM waterway way or synthetic open-water edges validated inside a
retained source water polygon. Open-water containment is checked during
compilation and again while serving a route. The router never joins features
by name or proximity and never returns a straight-line fallback.

A missing route is HTTP 422 with the failed leg and one of:

- `WAYPOINT_OFF_NETWORK`
- `NO_WATER_ROUTE`
- `ROUTE_VALIDATION_FAILED`

Missing or corrupt artifacts produce HTTP 503 `ROUTING_DATA_UNAVAILABLE`. The
legacy Supabase `get-route` function remains only for rollback.

## Deployment model

The immutable routing artifacts are committed under
`public/routing-v2/<version>/` and deploy with the application. The server API
loads the manifest and route-corridor shards through the deployment's
Cloudflare `ASSETS` binding (or same-origin fetch on other runtimes). This
design requires no production Supabase dashboard access, Storage bucket,
object upload, service-role credential, or routing-version secret.

The current version is declared in `src/lib/routingDataVersion.ts`. Changing
that constant and adding its matching artifact directory in the same commit is
an atomic code/data release on every preview and production deployment.

The only database behavior needed by scenic routing is defined by the
idempotent migration `20260715000000_use_routed_trip_distances.sql`. It updates
`calculate_trip_waypoints` to prefer verified routed leg distances and retains
the haversine fallback for legacy saved trips. With Lovable Test and Live
environments enabled, publishing applies the safe function migration with the
rest of the application schema; there is no data seed or manual SQL step.

## Rebuilding a future version

Rebuilding is a developer workflow, not a deployment operation. It is run and
reviewed before a release PR is opened:

```bash
npm run routing:download -- \
  --bbox 38.65,-77.5,39.15,-76.65 \
  --tile-degrees 0.25 \
  --version dmv-core-YYYY-MM-DD \
  --output data/osm-water-routing.json

npm run routing:build -- \
  --input data/osm-water-routing.json \
  --output public/routing-v2 \
  --version dmv-core-YYYY-MM-DD

ROUTING_GRAPH_DIRECTORY=public/routing-v2/dmv-core-YYYY-MM-DD \
  npm run test:routing-golden
```

The downloader uses resumable tiles and keeps its raw snapshot cache under
`data/`, which remains gitignored. The compiler refuses to overwrite an
existing version. Commit only the validated, versioned manifest and shards.

The current `dmv-core-2026-07-18` release covers the reviewed core corridor
`38.65,-77.5,39.15,-76.65`. Sites outside that compiled extent fail closed
until a future version expands the bbox; they never receive a direct line.

## Graph contents

- Exact-node OSM topology for rivers, canals, tidal channels, fairways,
  waterway links, and explicitly canoe-capable streams.
- A 75 m hex graph for wide water polygons with 10 m bank/island clearance.
- Access, intermittent-water, tunnel, culvert, barrier, canoe-route, and canoe
  pass metadata, including excluded feature geometry and source relation IDs.
- Precomputed natural-shoreline, paddling-interest, and quietness scores from
  nearby OSM context.

Private/forbidden waterways, unsupported intermittent streams, covered water,
and barriers without a canoe pass are excluded during compilation.

## Runtime behavior

The same-origin server API loads only shards intersecting the route corridor,
retrying with 5 km, 10 km, and 20 km padding. Manifests are cached for five
minutes and immutable shards for 30 minutes. Every waypoint pair is routed
independently in the supplied order.

For each leg, the router finds the shortest water path with A\*, generates up
to 20 loopless alternatives, rejects paths over 1.35 times the shortest water
distance, and ranks the remainder with 70% scenic value and 30% directness.

The response supplies per-leg geometry and distance, access connectors, snap
distances, provenance, highlights, warnings, and graph version. Access
connectors are displayed separately and are not counted as paddling distance.

## Release checks

- `npm ci`
- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run build`
- DMV golden routes against the committed artifact, including the deliberately
  impossible all-water route and warm/cold latency targets.
- Route builder at 390 px, desktop split layout, dark mode, long site names,
  route failures, and reduced-height screens.

Structured logs contain the data version, shard IDs, snap distances, candidate
count, validation result, failed leg, and elapsed time. Complete user route
coordinates are not logged.
