/**
 * Auth-stack counters (resolver, 401s, issuance, revocation, token minting, push targets).
 *
 * Same lazy-singleton shape as callMetrics.ts. Every `record*` is fire-and-forget: the OTel
 * API hands back a no-op meter when no SDK is registered, and the `add` is wrapped anyway, so
 * a metrics failure can never turn into an auth failure.
 */
import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export type AuthResolveMiddleware = 'v1' | 'v2' | 'refresh' | 'invite' | 'socket' | 'zero' | 'encryption' | 'login';
export type AuthSessionIssuedKind = 'login' | 'reuse' | 'legacy_convert' | 'sdk';
export type AuthSessionRevokedScope = 'session' | 'account' | 'legacy';
export type AuthTokenAudience = 'internal' | 'sdk' | 'cookie';
export type LegacyCredentialOutcome = 'row_converted' | 'cookies_migrated' | 'jwt_reissued';
export type PushTargetSource = 'session' | 'legacy';

export interface AuthResolveAttributes extends Attributes {
  path: string;
  outcome: 'ok' | 'fail';
  reason: string;
  middleware: AuthResolveMiddleware;
}
export interface Auth401Attributes extends Attributes {
  reason: string;
  platform: string;
  route_group: string;
}
export interface AuthSessionIssuedAttributes extends Attributes {
  kind: AuthSessionIssuedKind;
  platform: string;
}
export interface AuthSessionRevokedAttributes extends Attributes {
  reason: string;
  scope: AuthSessionRevokedScope;
}
export interface AuthTokenMintedAttributes extends Attributes {
  audience: AuthTokenAudience;
}
export interface PushTargetsAttributes extends Attributes {
  source: PushTargetSource;
}
export interface PushTokenMissingAttributes extends Attributes {
  platform: string;
}
export interface LegacyCredentialAttributes extends Attributes {
  source: string;
  platform: string;
  outcome: LegacyCredentialOutcome;
  legacy_mirror: 'true' | 'false';
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

function lazyCounter<A extends Attributes>(name: string, description: string): () => Counter<A> {
  let counter: Counter<A> | null = null;
  return () => {
    if (!counter) counter = getMeter().createCounter(name, { description, unit: '1' });
    return counter;
  };
}

const getAuthResolve = lazyCounter<AuthResolveAttributes>('auth_resolve_total', 'Auth resolver outcomes by credential path and middleware');
const getAuth401 = lazyCounter<Auth401Attributes>('auth_401_total', 'Requests rejected with 401 by reason, platform and route group');
const getSessionIssued = lazyCounter<AuthSessionIssuedAttributes>('auth_session_issued_total', 'Auth sessions issued / reused / converted by kind and platform');
const getSessionRevoked = lazyCounter<AuthSessionRevokedAttributes>('auth_session_revoked_total', 'Auth sessions / legacy rows revoked by reason and scope');
const getTokenMinted = lazyCounter<AuthTokenMintedAttributes>('auth_token_minted_total', 'Workspace JWTs minted by audience');
const getPushTargets = lazyCounter<PushTargetsAttributes>('push_targets_total', 'Push delivery targets resolved by store');
const getPushTokenMissing = lazyCounter<PushTokenMissingAttributes>('push_token_missing_total', 'Mobile sessions seen without a push token');
const getLegacyCredential = lazyCounter<LegacyCredentialAttributes>(
  'auth_legacy_credential_total',
  'Requests that authenticated with a legacy credential and were switched to the xs / xw_ cookies, by source and outcome',
);

function safeAdd<A extends Attributes>(name: string, get: () => Counter<A>, attrs: A, value = 1): void {
  try {
    get().add(value, attrs);
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
  middleware: AuthResolveMiddleware;
}): void {
  safeAdd('auth_resolve_total', getAuthResolve, {
    path: attrs.path,
    outcome: attrs.outcome,
    reason: attrs.reason ?? 'none',
    middleware: attrs.middleware,
  });
}

export function recordAuth401(attrs: { reason: string; platform: string; routeGroup: string }): void {
  safeAdd('auth_401_total', getAuth401, { reason: attrs.reason, platform: attrs.platform, route_group: attrs.routeGroup });
}

export function recordSessionIssued(attrs: { kind: AuthSessionIssuedKind; platform: string }): void {
  safeAdd('auth_session_issued_total', getSessionIssued, { kind: attrs.kind, platform: attrs.platform });
}

export function recordSessionRevoked(attrs: { reason: string; scope: AuthSessionRevokedScope }): void {
  safeAdd('auth_session_revoked_total', getSessionRevoked, { reason: attrs.reason, scope: attrs.scope });
}

export function recordTokenMinted(attrs: { audience: AuthTokenAudience }): void {
  safeAdd('auth_token_minted_total', getTokenMinted, { audience: attrs.audience });
}

export function recordPushTargets(attrs: { source: PushTargetSource; count: number }): void {
  if (!Number.isFinite(attrs.count) || attrs.count <= 0) return;
  safeAdd('push_targets_total', getPushTargets, { source: attrs.source }, attrs.count);
}

export function recordPushTokenMissing(attrs: { platform: string }): void {
  safeAdd('push_token_missing_total', getPushTokenMissing, { platform: attrs.platform });
}

/** One per request that arrived on a legacy credential (`[AUTH] legacy_session_converted` carries the detail). */
export function recordLegacyCredential(attrs: { source: string; platform: string; outcome: LegacyCredentialOutcome; legacyMirror: boolean }): void {
  safeAdd('auth_legacy_credential_total', getLegacyCredential, {
    source: attrs.source,
    platform: attrs.platform,
    outcome: attrs.outcome,
    legacy_mirror: attrs.legacyMirror ? 'true' : 'false',
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
