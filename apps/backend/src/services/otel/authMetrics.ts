/**
 * Auth-stack counters (resolver, refresh-session, 401s, issuance, revocation).
 *
 * Same lazy-singleton shape as callMetrics.ts. Every `record*` is fire-and-forget: the OTel
 * API hands back a no-op meter when no SDK is registered, and the `add` is wrapped anyway, so
 * a metrics failure can never turn into an auth failure.
 */
import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export type AuthResolveMiddleware = 'v1' | 'v2' | 'refresh' | 'invite';
export type AuthRefreshCaller = 'claw_like' | 'client';
export type AuthSessionIssuedKind = 'login' | 'switch' | 'lazy_grant' | 'backfill';
export type AuthSessionRevokedScope = 'session' | 'account' | 'grant' | 'legacy';

export interface AuthResolveAttributes extends Attributes {
  path: string;
  outcome: 'ok' | 'fail';
  reason: string;
  refreshed: boolean;
  middleware: AuthResolveMiddleware;
}

export interface AuthRefreshSessionAttributes extends Attributes {
  has_workspace_hint: boolean;
  caller: AuthRefreshCaller;
  outcome: 'ok' | 'fail';
  tokens_minted: number;
}

export interface Auth401Attributes extends Attributes {
  reason: string;
  platform: string;
  route_group: string;
}

export interface AuthSessionIssuedAttributes extends Attributes {
  kind: AuthSessionIssuedKind;
  write_mode: string;
  cookie_mode: string;
  token_mode: string;
}

export interface AuthSessionRevokedAttributes extends Attributes {
  reason: string;
  scope: AuthSessionRevokedScope;
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

let _authResolve: Counter<AuthResolveAttributes> | null = null;
function getAuthResolve(): Counter<AuthResolveAttributes> {
  if (!_authResolve) {
    _authResolve = getMeter().createCounter('auth_resolve_total', {
      description: 'Auth resolver outcomes by credential path and middleware',
      unit: '1',
    });
  }
  return _authResolve;
}

let _authRefreshSession: Counter<AuthRefreshSessionAttributes> | null = null;
function getAuthRefreshSession(): Counter<AuthRefreshSessionAttributes> {
  if (!_authRefreshSession) {
    _authRefreshSession = getMeter().createCounter('auth_refresh_session_total', {
      description: 'POST /api/auth/refresh-session calls by caller shape and outcome',
      unit: '1',
    });
  }
  return _authRefreshSession;
}

let _auth401: Counter<Auth401Attributes> | null = null;
function getAuth401(): Counter<Auth401Attributes> {
  if (!_auth401) {
    _auth401 = getMeter().createCounter('auth_401_total', {
      description: 'Requests rejected with 401 by reason, platform and route group',
      unit: '1',
    });
  }
  return _auth401;
}

let _authSessionIssued: Counter<AuthSessionIssuedAttributes> | null = null;
function getAuthSessionIssued(): Counter<AuthSessionIssuedAttributes> {
  if (!_authSessionIssued) {
    _authSessionIssued = getMeter().createCounter('auth_session_issued_total', {
      description: 'Auth sessions / grants issued by kind and the flag modes in force',
      unit: '1',
    });
  }
  return _authSessionIssued;
}

let _authSessionRevoked: Counter<AuthSessionRevokedAttributes> | null = null;
function getAuthSessionRevoked(): Counter<AuthSessionRevokedAttributes> {
  if (!_authSessionRevoked) {
    _authSessionRevoked = getMeter().createCounter('auth_session_revoked_total', {
      description: 'Auth sessions / grants / legacy rows revoked by reason and scope',
      unit: '1',
    });
  }
  return _authSessionRevoked;
}

function safeAdd<A extends Attributes>(name: string, get: () => Counter<A>, attrs: A): void {
  try {
    get().add(1, attrs);
  } catch (error) {
    // Metrics must never break auth. Debug-level: a broken meter would otherwise spam every request.
    logger.debug(`[authMetrics] failed to record ${name}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function recordAuthResolve(attrs: {
  path: string;
  outcome: 'ok' | 'fail';
  reason?: string;
  refreshed: boolean;
  middleware: AuthResolveMiddleware;
}): void {
  safeAdd('auth_resolve_total', getAuthResolve, {
    path: attrs.path,
    outcome: attrs.outcome,
    reason: attrs.reason ?? 'none',
    refreshed: attrs.refreshed,
    middleware: attrs.middleware,
  });
}

export function recordRefreshSession(attrs: {
  hasWorkspaceHint: boolean;
  caller: AuthRefreshCaller;
  outcome: 'ok' | 'fail';
  tokensMinted: number;
}): void {
  safeAdd('auth_refresh_session_total', getAuthRefreshSession, {
    has_workspace_hint: attrs.hasWorkspaceHint,
    caller: attrs.caller,
    outcome: attrs.outcome,
    tokens_minted: attrs.tokensMinted,
  });
}

export function recordAuth401(attrs: { reason: string; platform: string; routeGroup: string }): void {
  safeAdd('auth_401_total', getAuth401, {
    reason: attrs.reason,
    platform: attrs.platform,
    route_group: attrs.routeGroup,
  });
}

export function recordSessionIssued(attrs: {
  kind: AuthSessionIssuedKind;
  writeMode: string;
  cookieMode: string;
  tokenMode: string;
}): void {
  safeAdd('auth_session_issued_total', getAuthSessionIssued, {
    kind: attrs.kind,
    write_mode: attrs.writeMode,
    cookie_mode: attrs.cookieMode,
    token_mode: attrs.tokenMode,
  });
}

export function recordSessionRevoked(attrs: { reason: string; scope: AuthSessionRevokedScope }): void {
  safeAdd('auth_session_revoked_total', getAuthSessionRevoked, {
    reason: attrs.reason,
    scope: attrs.scope,
  });
}

/** Route-name shaped segment: lowercase, no ids. Anything else collapses to 'other'. */
const ROUTE_GROUP_RE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * Cheap, bounded-cardinality label for 401s: the first path segment after `/api`
 * (`/api/auth/me` → `auth`, `/api/tickets/123` → `tickets`). Paths without an `/api`
 * segment, or whose next segment does not look like a route name, map to `other`.
 */
export function routeGroupFromPath(path: string): string {
  if (typeof path !== 'string' || !path) return 'other';
  const pathname = path.split('?')[0].split('#')[0];
  const segments = pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const apiIndex = segments.indexOf('api');
  if (apiIndex === -1) return 'other';
  const group = segments[apiIndex + 1];
  if (!group || !ROUTE_GROUP_RE.test(group)) return 'other';
  return group;
}
