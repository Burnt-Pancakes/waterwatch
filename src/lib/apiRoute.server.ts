import { z, type ZodType } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ApiErrorPayload = {
  error: string;
  code: string;
  details?: unknown;
};

export const API_RATE_LIMIT = 100;
export const API_RATE_LIMIT_WINDOW_SECONDS = 60;

export function jsonResponse<T>(body: T, status = 200, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

export function errorResponse(
  message: string,
  code: string,
  status: number,
  details?: unknown,
  headers?: Record<string, string>,
) {
  return jsonResponse<ApiErrorPayload>({ error: message, code, details }, status, headers);
}

export function getRequestIp(request: Request): string | null {
  // Prefer Cloudflare's CF-Connecting-IP — it's set by the edge and cannot
  // be spoofed by clients. Only fall back to X-Forwarded-For / X-Real-IP
  // when CF-Connecting-IP is absent (e.g. local dev behind a different proxy).
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return null;
}

export function parseQuery<T extends ZodType>(request: Request, schema: T) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  return schema.parse(params);
}

export async function parseBody<T extends ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
  return schema.parse(json);
}

interface ApiRateLimitSuccess {
  allowed: true;
  limit: number;
  remaining: number;
  reset: number;
}

interface ApiRateLimitFailure {
  allowed: false;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Enforces a lightweight per-IP, per-endpoint rate limit using the existing
 * auth_rate_limits table.
 *
 * @param options.limit max requests per window (default: 100)
 * @param options.windowSeconds rolling window size in seconds (default: 60)
 */
export async function checkApiRateLimit(
  ip: string | null,
  kind: string,
  options?: { limit?: number; windowSeconds?: number },
): Promise<ApiRateLimitSuccess | ApiRateLimitFailure> {
  const limit = options?.limit ?? API_RATE_LIMIT;
  const windowSeconds = options?.windowSeconds ?? API_RATE_LIMIT_WINDOW_SECONDS;
  const ipKey = ip && ip.length > 0 ? ip : "unknown";
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const reset = Math.floor((Date.now() + windowSeconds * 1000) / 1000);

  const { count, error } = await supabaseAdmin
    .from("auth_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip", ipKey)
    .eq("kind", kind)
    .gte("attempted_at", windowStart);

  if (error) {
    console.error("API rate-limit count failed; failing open:", error);
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset,
    };
  }

  const current = count ?? 0;
  if (current >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: windowSeconds,
      limit,
      remaining: 0,
      reset,
    };
  }

  const { error: insertError } = await supabaseAdmin
    .from("auth_rate_limits")
    .insert({ ip: ipKey, kind });
  if (insertError) {
    console.error("API rate-limit insert failed:", insertError);
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - current - 1),
    reset,
  };
}

export function rateLimitHeaders(data: ApiRateLimitSuccess | ApiRateLimitFailure) {
  return {
    "RateLimit-Limit": String(data.limit),
    "RateLimit-Remaining": String(data.remaining),
    "RateLimit-Reset": String(data.reset),
  };
}
