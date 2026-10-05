// How a Xyne environment is addressed — and which hosts must never receive load.
//
// Sandbox is a separate deployment with its own host. Pre-production is NOT: it is the
// production host plus a routing header, exactly as the desktop app does it when the
// Beta menu's "Enable pre-prod features" is on:
//
//   apps/electron/src/services/request-interceptor.ts:129-131
//     if (preProdEnabled === true) headers['x-route-env'] = 'playground';
//
// That makes the environment *name* an unreliable guard. A run labelled `preprod` that
// points at the production host and omits the header is a production load test wearing a
// pre-production label, and every report would say "preprod" while the traffic lands on
// customers. So the host is checked directly, and the header is always sent for preprod.
//
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
 * Refuse a URL whose host serves production.
 *
 * Compares the parsed hostname exactly rather than by substring, so neither a lookalike
 * (`app.spaces.xyne.juspay.net.example.com`) nor a port or path disguises a real one.
 */
export function assertNotProductionHost(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return; // Shape is validated separately; nothing to refuse here.
  }

  if (PRODUCTION_HOSTS.includes(hostname)) {
    throw new Error(
      `${hostname} serves production and is refused regardless of the environment name. `
      + 'Pre-production is this same host plus the x-route-env header, so a name alone '
      + 'cannot keep load off customers. Point PERF_BASE_URL at sandbox, or at a '
      + 'pre-production host that is not in the production list.',
    );
  }
}
