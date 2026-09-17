/**
 * First-party host derivation for the Electron shell.
 *
 * Security gates — preload isTrustedOrigin(), request-interceptor
 * isFirstPartyUrl(), the cookie-sync IPC handler and the frontend CSP —
 * previously hardcoded an internal deployment suffix.
 * The suffix is now derived from the configured deployment URLs so the
 * open-source build carries no internal hostnames:
 *
 *   - `XYNE_FIRST_PARTY_HOST_SUFFIX` overrides the derivation outright.
 *     Internal deployments set this to their own suffix to keep the gate
 *     exactly as wide as before (e.g. `spaces.example.com`).
 *   - Otherwise the suffix is the longest common dot-suffix shared by the
 *     hosts of BACKEND_URL / MTLS_BACKEND_URL / MTLS_FRONTEND_URL /
 *     UNPROTECTED_URL / FRONTEND_URL / CLAW_AUTH_URL — first-party is
 *     precisely the deployment the app is configured to talk to.
 *
 * Pure module: no Electron imports, safe to use from the preload context
 * and from unit tests.
 */

/** Lowercased hostname of a URL, or null if the URL is unusable. */
export function hostnameOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Longest dot-suffix shared by every host: ["a.x.y.z", "b.x.y.z"] → "x.y.z". */
export function commonHostSuffix(hosts: string[]): string | null {
  const usable = hosts.filter((h) => h.length > 0);
  if (usable.length === 0) return null;

  let suffix = usable[0].split(".");
  for (let i = 1; i < usable.length; i++) {
    const labels = usable[i].split(".");
    const next: string[] = [];
    let a = suffix.length - 1;
    let b = labels.length - 1;
    while (a >= 0 && b >= 0 && suffix[a] === labels[b]) {
      next.unshift(suffix[a]);
      a--;
      b--;
    }
    suffix = next;
    if (suffix.length === 0) return null;
  }
  return suffix.join(".");
}

/**
 * First-party host suffix for a set of deployment URLs.
 *
 * `envSuffix` (normally `process.env.XYNE_FIRST_PARTY_HOST_SUFFIX`) wins when
 * set; otherwise the suffix is derived from the URLs' common host suffix.
 * Returns null when nothing usable is configured — callers must treat that
 * as "no first-party web origin" (fail closed).
 */
export function firstPartyHostSuffix(
  urls: Array<string | undefined>,
  envSuffix: string | undefined = process.env["XYNE_FIRST_PARTY_HOST_SUFFIX"],
): string | null {
  const trimmed = envSuffix?.trim().toLowerCase();
  if (trimmed) return trimmed.replace(/^\.+/, "");
  const hosts = urls
    .map(hostnameOf)
    .filter((host): host is string => host !== null);
  return commonHostSuffix(hosts);
}

/** True when `hostname` is the suffix itself or any subdomain of it. */
export function isFirstPartyHostname(
  hostname: string,
  suffix: string | null,
): boolean {
  if (!suffix || suffix.length === 0) return false;
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith("." + suffix);
}
