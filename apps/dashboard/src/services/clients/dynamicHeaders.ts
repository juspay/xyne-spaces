import axios from 'axios';
import { API_BASE_URL, VITE_ZERO_SERVER } from '../../config';

const STORAGE_KEY = 'xyne_dynamic_headers';

export const DYNAMIC_HEADERS_CHANGED_EVENT = 'xyne:dynamic-headers-changed';

// The only override the edge and backend act on: x-route-env picks a dashboard-edge lane
// (header or cookie) and the CAC environment. Anything else the server sends is ignored, so
// a pushed map can never replace identity headers or plant other cookies.
const ALLOWED_HEADERS = new Set(['x-route-env']);
const ALLOWED_VALUE = /^[a-z0-9-]{1,32}$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function sanitize(headers: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers ?? {})) {
    const name = rawName.toLowerCase();
    if (ALLOWED_HEADERS.has(name) && typeof value === 'string' && ALLOWED_VALUE.test(value)) {
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
  if (common.length === 1 && common[0] === 'localhost') return 'localhost';
  // Never a bare registrable domain (e.g. juspay.net): the cookie would reach every sibling app.
  if (common.length < 3) return null;
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
    writeCookie(name, value, COOKIE_MAX_AGE_SECONDS);
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
    const { data } = await axios.get<Record<string, string>>(`${API_BASE_URL}/client-events/me`, {
      withCredentials: true,
    });
    await applyDynamicHeaders(data ?? {});
  } catch {
    // keep the stored value when the fetch fails
  }
}

export async function performHardReload(): Promise<void> {
  if (window.electronAPI?.applyAppUpdate) {
    window.electronAPI.applyAppUpdate();
    return;
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
  } catch {
    // best-effort cache clear; reload regardless
  }
  window.location.reload();
}

/** Drops every dynamic header and its cookie. Called on logout and session clear. */
export function clearDynamicHeaders(): void {
  const previous = getDynamicHeaders();
  syncAxiosDefaults(previous, {});
  syncCookies(previous, {});
  localStorage.removeItem(STORAGE_KEY);
}

// Earlier builds applied any server-sent name and kept it as a 1-year cookie; expire those.
function expireLegacyCookies(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const name of Object.keys(stored)) {
      if (!ALLOWED_HEADERS.has(name.toLowerCase()) && /^[A-Za-z0-9_-]{1,64}$/.test(name)) {
        writeCookie(name, '', 0);
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getDynamicHeaders()));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

expireLegacyCookies();
syncAxiosDefaults({}, getDynamicHeaders());
syncCookies({}, getDynamicHeaders());
