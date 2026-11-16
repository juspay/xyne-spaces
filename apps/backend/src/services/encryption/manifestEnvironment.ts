import type { Request } from 'express';
import { config } from '@/config/env';

/**
 * Which client-manifest environment a request belongs to, read from the request itself:
 * no setting of its own. The backend forwards it to the encryption service as
 * `?environment=`, which signs that environment's manifest.
 *
 *   x-route-env = playground (header or cookie) → 'playground'   (pre-prod lane)
 *   host contains "sandbox"                     → 'sandbox'
 *   localhost / *.localhost, or NODE_ENV≠production → 'development'
 *   otherwise                                   → 'production'
 *
 * Production and pre-prod are two A/B stacks ("sides") behind one hostname, and which side
 * is prod changes at every rollout flip, so the lane has to follow the request: the
 * VirtualService routes on the same `x-route-env` signal (as does CAC, cacConfigController).
 */
export type ClientManifestEnvironment = 'production' | 'playground' | 'sandbox' | 'development';

const ROUTE_ENV_NAME = 'x-route-env';
const PRE_PROD_ROUTE = 'playground';

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name.endsWith('.localhost');
}

function environmentFor(
  routeEnv: string | undefined,
  host: string | undefined
): ClientManifestEnvironment {
  if (routeEnv?.trim().toLowerCase() === PRE_PROD_ROUTE) return 'playground';
  const h = (host ?? '').trim().toLowerCase();
  if (h.includes('sandbox')) return 'sandbox';
  if (config.env !== 'production' || isLocalHost(h)) return 'development';
  return 'production';
}

/** The host the client called: the proxy's forwarded host if any, else Host. */
function firstValue(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim() || undefined;
}

/** For an Express request: `x-route-env` header first, then the cookie (as the edge does). */
export function manifestEnvironmentForRequest(req: Request): ClientManifestEnvironment {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const cookie = cookies?.[ROUTE_ENV_NAME];
  const host = firstValue(req.headers['x-forwarded-host']) ?? firstValue(req.headers.host);
  return environmentFor(
    req.get(ROUTE_ENV_NAME) ?? (typeof cookie === 'string' ? cookie : undefined),
    host
  );
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** For a Socket.IO handshake, whose headers and cookies carried the same signals. */
export function manifestEnvironmentForHandshake(
  headers: Record<string, string | string[] | undefined>
): ClientManifestEnvironment {
  const cookie = headers.cookie;
  const routeEnv =
    firstValue(headers[ROUTE_ENV_NAME]) ??
    cookieValue(Array.isArray(cookie) ? cookie.join('; ') : cookie, ROUTE_ENV_NAME);
  return environmentFor(
    routeEnv,
    firstValue(headers['x-forwarded-host']) ?? firstValue(headers.host)
  );
}

/**
 * Fallback when there is no request to read (startup contract check, callers that pass no
 * environment): NODE_ENV only, i.e. 'production' or 'development'.
 */
export function defaultManifestEnvironment(): ClientManifestEnvironment {
  return config.env === 'production' ? 'production' : 'development';
}
