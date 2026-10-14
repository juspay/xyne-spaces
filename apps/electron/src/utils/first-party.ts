/**
 * The first-party trust boundary, derived from config.
 *
 * The privileged preload bridge (mTLS key generation, cookie/session control,
 * native file access), the permission guards and the frontend CSP all answer one
 * question: is this origin one this build's deployment serves? Answering it from
 * a hardcoded host list is what made a new domain a code change — and the
 * failure was silent, because an unlisted frontend simply never receives
 * `window.electronAPI` and degrades to plain-web behaviour.
 *
 * Hosts therefore come from the resolved config, which already carries the
 * channel defaults overlaid with the selected tenant. A deployment that needs
 * sibling hosts trusted beyond the ones it names lists suffixes in
 * TRUSTED_HOST_SUFFIXES; every entry grants the bridge to all subdomains of that
 * suffix, so only domains the deployment alone serves belong there.
 */
import { config } from '../app/config';

// Every renderer origin a build loads, plus the API origins its pages call.
const CONFIG_URLS: readonly string[] = [
  config.FRONTEND_URL,
  config.BACKEND_URL,
  config.MTLS_FRONTEND_URL,
  config.MTLS_BACKEND_URL,
  config.UNPROTECTED_URL,
  config.CLAW_AUTH_URL,
];

const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

function parseUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

const CONFIG_HOSTS: readonly string[] = [
  ...new Set(
    CONFIG_URLS.map((url) => parseUrl(url)?.hostname.toLowerCase()).filter(
      (host): host is string => !!host,
    ),
  ),
];

// Normalised once: a tenant file is hand-written JSON, so accept 'xyne.test'
// alongside '.xyne.test' and treat the value case-insensitively.
const TRUSTED_SUFFIXES: readonly string[] = [
  ...new Set(
    (config.TRUSTED_HOST_SUFFIXES ?? [])
      .filter((suffix): suffix is string => typeof suffix === 'string' && suffix.trim().length > 0)
      .map((suffix) => {
        const trimmed = suffix.trim().toLowerCase();
        return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
      }),
  ),
];

export function isFirstPartyHost(rawHost: string | null | undefined): boolean {
  if (typeof rawHost !== 'string' || rawHost.length === 0) return false;
  const host = rawHost.toLowerCase();
  if (LOCAL_HOSTS.includes(host)) return true;
  if (CONFIG_HOSTS.includes(host)) return true;
  // A suffix also covers its own apex: '.xyne.test' trusts 'xyne.test'.
  return TRUSTED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

export interface FirstPartyHostRules {
  hosts: string[];
  suffixes: string[];
  localHosts: string[];
}

/**
 * The host rules preload.ts needs. It runs sandboxed, so it can neither require
 * this module nor read config, and asks main for them over a sync IPC instead.
 */
export function firstPartyHostRules(): FirstPartyHostRules {
  return {
    hosts: [...CONFIG_HOSTS],
    suffixes: [...TRUSTED_SUFFIXES],
    localHosts: [...LOCAL_HOSTS],
  };
}

/** Mirrors preload.ts isTrustedOrigin(), evaluated main-side against a URL. */
export function isFirstPartyUrl(rawUrl: string | null | undefined): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  const protocol = url.protocol.toLowerCase();
  if (protocol.startsWith('xyne-spaces')) return true; // bundled UI custom scheme
  if (protocol === 'file:') return true; // bundled local HTML
  if (protocol !== 'https:' && protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  // Plaintext http is first party only for local development.
  if (protocol === 'http:') return LOCAL_HOSTS.includes(host);
  return isFirstPartyHost(host);
}

/**
 * First-party CSP sources as one space-separated source list. 'http' yields the
 * http(s) origins, 'ws' the websocket ones for the same hosts.
 */
export function firstPartyCspSources(kind: 'http' | 'ws'): string {
  const sources = new Set<string>();
  for (const suffix of TRUSTED_SUFFIXES) {
    sources.add(`${kind === 'http' ? 'https' : 'wss'}://*${suffix}`);
  }
  for (const raw of CONFIG_URLS) {
    const url = parseUrl(raw);
    if (!url) continue;
    const secure = url.protocol.toLowerCase() === 'https:';
    const scheme = kind === 'http' ? (secure ? 'https' : 'http') : secure ? 'wss' : 'ws';
    sources.add(`${scheme}://${url.host}`);
  }
  return [...sources].join(' ');
}
