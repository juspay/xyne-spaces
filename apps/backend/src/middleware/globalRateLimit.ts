import { createHash } from 'crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, RateLimitRequestHandler, Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { config } from '@/config/env';
import { createRedisClient, connectWithRetryForever } from '@/services/redisFactory';
import { logger } from '@/utils/logger';

/**
 * Global, always-on rate limiter.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every HTTP route in this service must be rate limited. Relying on each router
 * to remember to add its own limiter is exactly how endpoints ended up
 * unprotected (the CodeQL `missing-rate-limiting` alerts). This middleware is
 * mounted ONCE at the app level so a sensible default is enforced on every
 * request — even when a developer forgets to configure anything for a new route.
 *
 * HOW TO RAISE (OR TIGHTEN) A SPECIFIC ENDPOINT
 * ---------------------------------------------
 * Do NOT add a second limiter on the route. Instead pass the value for that
 * endpoint through the override registry — one line, next to where the route is
 * mounted (or here in DEFAULT_OVERRIDES):
 *
 *     import { registerRateLimit } from '@/middleware/globalRateLimit';
 *     registerRateLimit('/api/heavy-report', { limit: 500 });          // raise
 *     registerRateLimit('/api/auth/login',   { limit: 20 });           // tighten
 *     registerRateLimit('/api/livekit',      { skip: true });          // opt out (S2S)
 *
 * The most specific (longest) matching prefix wins. Anything without an override
 * gets DEFAULT_LIMIT / DEFAULT_WINDOW_MS.
 *
 * KEYING
 * ------
 * This runs BEFORE per-route auth, so `req.user` is not populated yet. We derive
 * a stable per-caller key from the auth material already on the raw request
 * (Bearer token or session cookie, hashed — never stored in clear), falling back
 * to the client IP for anonymous traffic. Buckets are per-endpoint-group AND
 * per-caller, so a chatty read endpoint can never exhaust a user's login budget.
 *
 * STORE
 * -----
 * Backed by a SHARED Redis store (rate-limit-redis over a dedicated ioredis
 * client from redisFactory), so the ceiling is exact across all backend
 * replicas — not `limit × replicaCount`. All limiter instances share one client
 * (distinct key prefixes per window). If Redis is unreachable the limiter FAILS
 * OPEN (`passOnStoreError: true`) so an outage never 500s live traffic, and it
 * can be forced to the per-pod in-memory store with `RATE_LIMIT_STORE=memory`.
 */

export interface RateLimitOverride {
  /** Max requests per window for this endpoint group, per caller. */
  limit?: number;
  /** Window length in ms. Defaults to the global window. */
  windowMs?: number;
  /** Skip the global limiter entirely (e.g. routes with their own limiter / S2S). */
  skip?: boolean;
  /** Optional stable name used in the bucket key + logs. Defaults to the prefix. */
  name?: string;
}

interface RegistryEntry extends RateLimitOverride {
  prefix: string;
}

// Defaults — protective baseline applied to every route with no override.
// Overridable via existing env (RATE_LIMIT_* already validated in config/env.ts).
export const DEFAULT_WINDOW_MS = 60 * 1000;
export const DEFAULT_LIMIT = Number(config.rateLimit?.max) > 0 ? Number(config.rateLimit.max) : 100;

/**
 * Built-in overrides, sized from 7-day production traffic:
 *  - session/read endpoints are chatty (token refresh + polling) -> generous.
 *  - credential endpoints are rare per user -> tight (brute-force guard).
 *  - MCP / expensive endpoints -> moderate.
 *  - webhook / S2S / raw-body / callback routes already have dedicated limiters
 *    or are machine-to-machine -> skipped here so they are not double-limited or
 *    clipped by the low default.
 */
const DEFAULT_OVERRIDES: Array<[string, RateLimitOverride]> = [
  // Chatty authenticated reads
  ['/api/auth/me', { limit: 240, name: 'auth-read' }],
  ['/api/auth/refresh-session', { limit: 240, name: 'auth-read' }],
  ['/api/auth/permissions', { limit: 240, name: 'auth-read' }],
  ['/api/auth/roles', { limit: 240, name: 'auth-read' }],
  // Credential / login — brute-force & credential-stuffing guard
  ['/api/auth/login', { limit: 20, name: 'auth-cred' }],
  ['/api/auth/login-workspace', { limit: 20, name: 'auth-cred' }],
  ['/api/auth/exchange', { limit: 30, name: 'auth-cred' }],
  ['/api/v2/auth', { limit: 30, name: 'auth-v2' }],
  // MCP / claw query — expensive
  ['/api/query', { limit: 60, name: 'mcp' }],
  // Webhooks / S2S / callbacks — own limiter or machine-to-machine; do not clip.
  ['/api/webhooks', { skip: true }],
  ['/api/automation-webhooks', { skip: true }],
  ['/api/calendar/webhooks', { skip: true }],
  ['/api/external-source-sync', { skip: true }],
  ['/api/livekit', { skip: true }],
  ['/api/meet', { skip: true }],
  ['/api/sam', { skip: true }],
  ['/api/mettle', { skip: true }],
  ['/api/transcriptionAgent', { skip: true }],
  ['/api/migration', { skip: true }],
  ['/api/health', { skip: true }],
];

const registry: RegistryEntry[] = [];

/** Register or replace the rate-limit config for a path prefix. */
export function registerRateLimit(prefix: string, override: RateLimitOverride): void {
  const normalized = prefix.replace(/\/+$/, '') || '/';
  const existingIndex = registry.findIndex(e => e.prefix === normalized);
  const entry: RegistryEntry = { prefix: normalized, ...override };
  if (existingIndex >= 0) {
    registry[existingIndex] = entry;
  } else {
    registry.push(entry);
  }
  // Longest prefix first so the most specific override wins.
  registry.sort((a, b) => b.prefix.length - a.prefix.length);
}

DEFAULT_OVERRIDES.forEach(([prefix, override]) => registerRateLimit(prefix, override));

function resolveOverride(pathname: string): RegistryEntry | undefined {
  return registry.find(
    e => pathname === e.prefix || pathname.startsWith(e.prefix + '/') || e.prefix === '/'
  );
}

/** Path without query string, resilient to how the request is mounted. */
function requestPath(req: Request): string {
  const url = req.originalUrl || req.url || '';
  const qIndex = url.indexOf('?');
  return qIndex >= 0 ? url.slice(0, qIndex) : url;
}

/** Leftmost X-Forwarded-For entry, else the socket address. Keying only. */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  const ip = (first?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown');
  return ipKeyGenerator(ip);
}

/**
 * Stable per-caller identity derived from auth material present on the raw
 * request (this runs before per-route auth). Secrets are hashed, never stored.
 */
function callerKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return 'tok:' + createHash('sha256').update(token).digest('hex').slice(0, 32);
  }
  const cookie = req.headers.cookie;
  if (cookie) return 'ck:' + createHash('sha256').update(cookie).digest('hex').slice(0, 32);
  return 'ip:' + clientIp(req);
}

const tooMany = (retryAfterMs: number) => ({
  success: false,
  error: 'Too many requests. Please slow down and try again shortly.',
  retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  timestamp: new Date().toISOString(),
});

const useRedis = config.rateLimit?.store !== 'memory';

// One dedicated, lazily-connected client shared by every limiter instance.
let redisClient: ReturnType<typeof createRedisClient> | undefined;
function getRedisClient(): ReturnType<typeof createRedisClient> | undefined {
  if (!useRedis) return undefined;
  if (!redisClient) {
    redisClient = createRedisClient('rate-limit');
    // Fire-and-forget connect; commands also auto-connect (lazyConnect). On a
    // hard outage the limiter fails open via passOnStoreError below.
    void connectWithRetryForever(redisClient, 'rate-limit').catch(() => undefined);
  }
  return redisClient;
}

// A fresh RedisStore per window (own key prefix) so windows never collide.
function makeStore(windowMs: number): Store | undefined {
  const client = getRedisClient();
  if (!client) return undefined; // undefined => express-rate-limit's memory store
  return new RedisStore({
    sendCommand: (command: string, ...args: string[]) =>
      client.call(command, ...args) as Promise<never>,
    prefix: `rl:${windowMs}:`,
  });
}

// One express-rate-limit instance per distinct window length. The `limit` is
// resolved per request from the registry, so a single instance serves every
// endpoint group that shares a window.
const instances = new Map<number, RateLimitRequestHandler>();

function limiterFor(windowMs: number): RateLimitRequestHandler {
  const existing = instances.get(windowMs);
  if (existing) return existing;

  const handler = rateLimit({
    windowMs,
    store: makeStore(windowMs),
    // Redis blip must never take down live traffic — allow the request through.
    passOnStoreError: true,
    limit: (req: Request): number => {
      const o = resolveOverride(requestPath(req));
      return o?.limit ?? DEFAULT_LIMIT;
    },
    keyGenerator: (req: Request): string => {
      const o = resolveOverride(requestPath(req));
      const group = o?.name ?? o?.prefix ?? 'default';
      return `${group}|${callerKey(req)}`;
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // We derive the key ourselves (never trust req.ip blindly), so silence the
    // proxy validators that would otherwise error at boot behind the ingress.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req: Request, res: Response, _next: NextFunction, options): void => {
      logger.warn('[rate-limit] blocked', {
        path: requestPath(req),
        method: req.method,
        key: (req as Request & { rateLimit?: { key?: string } }).rateLimit?.key,
      });
      res.status(options.statusCode).json(tooMany(options.windowMs));
    },
  });

  instances.set(windowMs, handler);
  return handler;
}

/**
 * The always-on dispatcher. Mount this ONCE at the app level. It resolves the
 * per-endpoint override on every request and applies the matching limiter,
 * falling back to the protective default when nothing is registered.
 */
export const globalRateLimiter: RequestHandler = (req, res, next) => {
  const override = resolveOverride(requestPath(req));
  if (override?.skip) return next();
  const windowMs = override?.windowMs ?? DEFAULT_WINDOW_MS;
  return limiterFor(windowMs)(req, res, next);
};
