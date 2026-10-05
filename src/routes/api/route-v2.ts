import { createFileRoute } from "@tanstack/react-router";
import { ROUTING_DATA_PUBLIC_PATH } from "@/lib/routingDataVersion";
import { getRoutingAssetFetch } from "@/lib/routingAssetFetch.server";
import { routeScenicRequestFromAssets } from "@/lib/scenicRouteApi.server";
import { ScenicRouteError } from "../../../supabase/functions/_shared/scenicRouting";

export async function handleScenicRouteRequest(
  request: Request,
  options: { fetchImpl?: typeof fetch; manifestUrl?: string } = {},
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "Invalid JSON." } },
      { status: 400 },
    );
  }

  try {
    const manifestUrl =
      options.manifestUrl ?? new URL(ROUTING_DATA_PUBLIC_PATH, request.url).toString();
    const assetFetch = options.fetchImpl ?? (await getRoutingAssetFetch());
    const result = await routeScenicRequestFromAssets(body, manifestUrl, assetFetch);
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(
      JSON.stringify({
        event: "scenic_route_success",
        requestId,
        dataVersion: result.route.dataVersion,
        expansionKm: result.expansionKm,
        loadedShards: result.loadedShards,
        legCount: result.route.legs.length,
        snapDistancesMeters: result.route.legs.flatMap((leg) =>
          leg.snapDistancesMeters.map(Math.round),
        ),
        candidateCount: result.route.legs.reduce((sum, leg) => sum + leg.candidateCount, 0),
        validationResult: "passed",
        elapsedMs,
      }),
    );
    return Response.json({
      ...result.route,
      requestId,
      attribution: "© OpenStreetMap contributors",
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (error instanceof TypeError) {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: error.message }, requestId },
        { status: 400 },
      );
    }
    if (error instanceof ScenicRouteError) {
      console.warn(
        JSON.stringify({
          event: "scenic_route_unavailable",
          requestId,
          code: error.code,
          legIndex: error.legIndex,
          snapDistancesMeters: error.diagnostics.snapDistancesMeters?.map(Math.round) ?? [],
          candidateCount: error.diagnostics.candidateCount ?? 0,
          validationResult: error.diagnostics.validationResult ?? "not_run",
          elapsedMs,
        }),
      );
      return Response.json(
        {
          error: { code: error.code, legIndex: error.legIndex, message: error.message },
          requestId,
        },
        { status: 422 },
      );
    }
    console.error(
      JSON.stringify({
        event: "scenic_route_data_error",
        requestId,
        message: error instanceof Error ? error.message : String(error),
        elapsedMs,
      }),
    );
    return Response.json(
      {
        error: {
          code: "ROUTING_DATA_UNAVAILABLE",
          message: "Verified water-routing data is temporarily unavailable.",
        },
        requestId,
      },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/route-v2")({
  server: {
    handlers: {
      POST: ({ request }) => handleScenicRouteRequest(request),
    },
  },
});
