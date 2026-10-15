// How a Xyne environment is addressed — and which hosts must never receive load.
//
// Sandbox is a separate deployment with its own host. Pre-production is NOT: it is the
// production host plus a routing header, exactly as the desktop app does it when the
// Beta menu's "Enable pre-prod features" is on:
//
//   apps/electron/src/services/request-interceptor.ts:129-131
//     if (preProdEnabled === true) headers['x-route-env'] = 'playground';
//
// That makes the environment *name* an unreliable guard on its own. A run labelled
// `sandbox` that points at the production host is a production load test wearing a
// sandbox label. So the host is checked directly: the production host is accepted only for
// `preprod`, whose profiles the catalog already limits to smoke and release, and the
// header is always sent for preprod so its traffic resolves the pre-production feature set.

// Pure data and functions only — no k6 globals — so the k6 scenarios and the Node runner
// and test suite can all import it.

// apps/electron/src/app/config.ts:65-70
export const PRODUCTION_HOSTS = Object.freeze([
  'app.spaces.xyne.juspay.net',
  'auth.spaces.xyne.juspay.net',
]);

/** Headers that select the environment behind a shared host. */
export function routeEnvHeaders(environment) {
  return environment === 'preprod' ? { 'x-route-env': 'playground' } : {};
}

/**
 * Refuse a production host unless the run is a pre-production run.
 *
 * Pre-production has no host of its own, so it is the one environment that may address
 * the production host; `resolveRunConfig` restricts it to the smoke and release profiles.
 * Compares the parsed hostname exactly rather than by substring, so neither a lookalike
 * (`app.spaces.xyne.juspay.net.example.com`) nor a port or path disguises a real one.
 */
export function assertNotProductionHost(url, environment) {
  if (environment === 'preprod') return;

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return; // Shape is validated separately; nothing to refuse here.
  }

  if (PRODUCTION_HOSTS.includes(hostname)) {
    throw new Error(
      `${hostname} serves production and is refused for the ${environment ?? 'sandbox'} environment. `
      + 'Point PERF_BASE_URL at sandbox, or use --environment preprod, which adds the '
      + 'x-route-env header and is limited to the smoke and release profiles.',
    );
  }
}
