import axios from 'axios';
import { API_BASE_URL, VITE_ZERO_SERVER } from '../../config';

const STORAGE_KEY = 'xyne_dynamic_headers';

export const DYNAMIC_HEADERS_CHANGED_EVENT = 'xyne:dynamic-headers-changed';

function sanitize(headers: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') {
      result[name] = value;
    }
  }
  return result;
}

export function getDynamicHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sameHeaders(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  return aKeys.length === Object.keys(b).length && aKeys.every(key => a[key] === b[key]);
}

function syncAxiosDefaults(previous: Record<string, string>, next: Record<string, string>): void {
  for (const name of Object.keys(previous)) {
    if (!(name in next)) {
      delete axios.defaults.headers.common[name];
    }
  }
  for (const [name, value] of Object.entries(next)) {
    axios.defaults.headers.common[name] = value;
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url, window.location.origin).hostname;
  } catch {
    return null;
  }
}

// Widest domain the routing cookies must reach: the common label-suffix of the
// app, API, and Zero hosts (browsers attach cookies to ws handshakes — the one
// transport page JS cannot set headers on).
function commonCookieDomain(): string | null {
  const hostnames = [window.location.origin, API_BASE_URL, VITE_ZERO_SERVER]
    .map(hostnameOf)
    .filter((hostname): hostname is string => hostname !== null);
  const parts = hostnames.map(hostname => hostname.split('.').reverse());
  const [first, ...rest] = parts;
  if (!first) return null;
  const common = [];
  for (let i = 0; i < first.length; i++) {
    if (!rest.every(labels => labels[i] === first[i])) break;
    common.push(first[i]);
  }
  if (common.length === 0) return null;
  if (common.length === 1 && common[0] !== 'localhost') return null;
  return common.reverse().join('.');
}

const COOKIE_DOMAIN = commonCookieDomain();

function writeCookie(name: string, value: string, maxAge: number): void {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  if (COOKIE_DOMAIN) cookie += `; Domain=${COOKIE_DOMAIN}`;
  if (window.location.protocol === 'https:') cookie += '; Secure';
  document.cookie = cookie;
}

function syncCookies(previous: Record<string, string>, next: Record<string, string>): void {
  for (const name of Object.keys(previous)) {
    if (!(name in next)) {
      writeCookie(name, '', 0);
    }
  }
  for (const [name, value] of Object.entries(next)) {
    writeCookie(name, value, 60 * 60 * 24 * 365);
  }
}

export async function applyDynamicHeaders(
  headers: Record<string, string> | null | undefined,
): Promise<void> {
  const previous = getDynamicHeaders();
  const next = sanitize(headers);
  if (sameHeaders(previous, next)) return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  syncAxiosDefaults(previous, next);
  syncCookies(previous, next);
  if (window.electronAPI?.setDynamicHeaders) {
    try {
      await window.electronAPI.setDynamicHeaders(next);
    } catch {
      // web-side routing still applies
    }
  }

  // dynamic imports: socketClient statically imports this module
  const [{ websocketService }, { stateMachineActor }] = await Promise.all([
    import('./socketClient'),
    import('../../machines/stateMachine'),
  ]);
  websocketService.forceReconnect();
  stateMachineActor.send({ type: 'REFRESH_ZERO' });
  window.dispatchEvent(new CustomEvent(DYNAMIC_HEADERS_CHANGED_EVENT));
}

export async function hydrateDynamicHeaders(): Promise<void> {
  try {
    const { data } = await axios.get<Record<string, string>>(
      `${API_BASE_URL}/user-header-overrides/me`,
      { withCredentials: true },
    );
    await applyDynamicHeaders(data ?? {});
  } catch {
    // keep the stored value when the fetch fails
  }
}

syncAxiosDefaults({}, getDynamicHeaders());
syncCookies({}, getDynamicHeaders());
