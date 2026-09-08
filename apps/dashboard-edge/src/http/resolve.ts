// GET /resolve: nginx's auth_request subrequest. Answers with the rule,
// bundle, cache key version and object path as headers, which nginx turns
// into its cache key and proxy_pass target.
//
//   200  matched: X-Edge-* headers set
//   401  no rule matched           -> nginx error_page 401 = @norule  (404)
//   403  rules not loaded yet      -> nginx error_page 403 = @notready (503)
import type { IncomingMessage, ServerResponse } from 'node:http';

import { isRouteLike } from '../contentType.js';
import { metrics } from '../metrics.js';
import { keyVersion, resolve, type RequestView } from '../rules/match.js';
import type { RulesStore } from '../rules/store.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const name = pair.slice(0, eq).trim();
    if (name !== '' && !(name in cookies)) {
      cookies[name] = pair.slice(eq + 1).trim();
    }
  }
  return cookies;
}

/** Header-safe rendering of the skipped list: printable ASCII only. */
function headerSafe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, '?').slice(0, 1024);
}

function encodeObject(object: string): string {
  return object.split('/').map(encodeURIComponent).join('/');
}

/**
 * nginx passes the raw request line URI ($request_uri). Normalise it the way
 * nginx's $uri would: drop the query string, percent-decode, collapse
 * repeated slashes and resolve dot segments. Returns null when the path
 * cannot be decoded or climbs above the root.
 */
export function normalisePath(rawUri: string): string | null {
  const q = rawUri.indexOf('?');
  const raw = q >= 0 ? rawUri.slice(0, q) : rawUri;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return '/';
  }
  const trailing = /\/\.{0,2}$/.test(decoded) ? '/' : '';
  return `/${segments.join('/')}${trailing}`;
}

export function buildRequestView(req: IncomingMessage): RequestView | null {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name] = headerValue(value);
  }
  const path = normalisePath(headers['x-original-uri'] ?? '/');
  if (path === null) {
    return null;
  }
  return {
    path,
    headers,
    cookies: parseCookies(headers['cookie']),
    userAgent: headers['user-agent'] ?? '',
  };
}

export function makeResolveHandler(
  store: RulesStore,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const ruleset = store.current();
    if (!ruleset) {
      metrics.resolves.inc({ rule: 'not_ready' });
      res.writeHead(403, { 'X-Edge-Rule': 'none', 'X-Edge-Error': 'rules not loaded' });
      res.end();
      return;
    }

    const view = buildRequestView(req);
    if (!view) {
      metrics.resolves.inc({ rule: 'bad_request' });
      res.writeHead(401, { 'X-Edge-Rule': 'none', 'X-Edge-Error': 'invalid request path' });
      res.end();
      return;
    }
    const { resolution, skipped } = await resolve(ruleset.rules, view, (b) => store.exists(b));
    const headers: Record<string, string> = {};
    if (skipped.length > 0) {
      headers['X-Edge-Skipped'] = headerSafe(
        skipped.map((s) => `${s.id} (${s.reason})`).join('; '),
      );
    }
    if (!resolution) {
      metrics.resolves.inc({ rule: 'none' });
      headers['X-Edge-Rule'] = 'none';
      res.writeHead(401, headers);
      res.end();
      return;
    }

    metrics.resolves.inc({ rule: resolution.rule.id });
    headers['X-Edge-Rule'] = resolution.rule.id;
    headers['X-Edge-Bundle'] = resolution.bundle;
    headers['X-Edge-Version'] = keyVersion(resolution);
    headers['X-Edge-Object'] = encodeObject(resolution.object);
    headers['X-Edge-Cache-Mode'] = resolution.cache;
    headers['X-Edge-Bypass'] = resolution.cache === 'never' ? '1' : '0';
    headers['X-Edge-Spa'] = isRouteLike(resolution.object) ? '1' : '0';
    res.writeHead(200, headers);
    res.end();
  };
}
