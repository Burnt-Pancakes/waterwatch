interface StaticAssetBinding {
  fetch(request: Request): Promise<Response>;
}

/**
 * Read deployment-bundled routing files without a Worker-to-itself network
 * request. Lovable's Cloudflare build exposes public assets through ASSETS;
 * other runtimes fall back to a normal same-origin fetch.
 */
export async function getRoutingAssetFetch(): Promise<typeof fetch> {
  try {
    const { env } = await import("cloudflare:workers");
    const assets = env.ASSETS as StaticAssetBinding | undefined;
    if (assets?.fetch) {
      return ((input: string | URL | Request, init?: RequestInit) =>
        assets.fetch(new Request(input, init))) as typeof fetch;
    }
  } catch {
    // The cloudflare:workers module does not exist on non-Cloudflare hosts.
  }
  return fetch;
}
