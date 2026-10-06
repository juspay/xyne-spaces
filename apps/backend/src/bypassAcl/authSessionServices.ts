/**
 * Cross-tenant access for the account-session auth stack (`auth_sessions`,
 * `session_workspace_grants`, legacy `workflow.user_sessions`).
 *
 * Everything here runs before a request has a tenant context (the resolver IS what
 * establishes `req.user`) or spans several workspaces (one account session holds one grant
 * per workspace), so every call is an explicit `asSystem` / `transaction` bypass.
 *
 * Dual-write invariant: every legacy row of one auth session shares
 * `refreshToken = session.deviceKey`; each grant points at its own legacy row via
 * `legacySessionId`, and the login grant's row is also `session.legacySessionId`.
 */
import { randomUUID } from 'crypto';
import type { Prisma, SessionWorkspaceGrant, UserSession } from '@prisma/client';
import { Platform, SessionStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { encrypt } from '@/services/encryptionService';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { UserSessionService, type LoginMethod, type LogoutReason } from '@/services/userSessionService';
import { recordSessionIssued, recordSessionRevoked } from '@/services/otel/authMetrics';
import { effectiveIssuanceModes, getAuthSessionFlags } from '@/auth/flags';
import { mintSessionCredential, sessionLookupWhere } from '@/auth/sessionTokens';
import { toSessionPlatform } from '@/auth/platform';
import { redisRevocationStore } from '@/auth/revocation';
import type {
  AddGrantInput,
  AddGrantResult,
  AuthSessionWithGrants,
  LegacySessionWithUser,
  MembershipUser,
  OrgMemberRef,
  RequestPlatform,
  SessionPlatform,
  SessionRepository,
} from '@/auth/types';
import { asSystem, transaction } from './base';

const userSessionService = new UserSessionService();

const MEMBERSHIP_SELECT = {
  id: true,
  email: true,
  name: true,
  picture: true,
  displayName: true,
  workspaceId: true,
  role: true,
  orgMemberId: true,
  authProvider: true,
  providerUserId: true,
  status: true,
  leftAt: true,
} as const satisfies Prisma.UserSelect;

const LEGACY_CANDIDATE_SELECT = { id: true, userId: true, deviceInfo: true, createdAt: true } as const;

function sessionExpiryFrom(now: Date): Date {
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + config.session.expiryDays);
  return expiry;
}

function trackPlatform(platform: SessionPlatform): Platform {
  if (platform === 'ELECTRON') return Platform.ELECTRON;
  if (platform === 'MOBILE') return Platform.MOBILE;
  return Platform.WEB;
}

function loginMethodForGrant(kind: AddGrantInput['kind'], explicit?: LoginMethod): LoginMethod {
  if (explicit) return explicit;
  switch (kind) {
    case 'create':
      return 'WORKSPACE_CREATED';
    case 'join':
      return 'WORKSPACE_JOINED';
    case 'switch':
      return 'WORKSPACE_SWITCH';
    default:
      return 'AUTO_LOGIN';
  }
}

/** Grant rows that may still act: not revoked and not past `expiresAt`. */
export function isGrantActive(grant: SessionWorkspaceGrant, now: Date = new Date()): boolean {
  return !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** `xs1_` payload → ACTIVE session (hash match or id match), grants included. */
export function findSessionByToken(payload: string): Promise<AuthSessionWithGrants | null> {
  return asSystem(
    ['AuthSession', 'SessionWorkspaceGrant'],
    'auth resolver: opaque session token lookup runs before any tenant context exists',
    () =>
      db.authSession.findFirst({
        where: { AND: [sessionLookupWhere(payload), { status: SessionStatus.ACTIVE }] },
        include: { grants: true },
      }),
  );
}

export function findSessionById(sessionId: string): Promise<AuthSessionWithGrants | null> {
  return asSystem(
    ['AuthSession', 'SessionWorkspaceGrant'],
    'auth issuer: session lookup by id for workspace switch / refresh, spans every workspace of the account',
    () => db.authSession.findUnique({ where: { id: sessionId }, include: { grants: true } }),
  );
}

/** Legacy `user_sessions` id → session via grant.legacySessionId first, then session.legacySessionId. */
export function findSessionByLegacyId(
  legacyId: string,
): Promise<{ session: AuthSessionWithGrants; grant: SessionWorkspaceGrant | null } | null> {
  return asSystem(
    ['AuthSession', 'SessionWorkspaceGrant'],
    'auth resolver: legacy session id → auth session mapping runs before any tenant context exists',
    async () => {
      const viaGrant = await db.sessionWorkspaceGrant.findUnique({
        where: { legacySessionId: legacyId },
        include: { session: { include: { grants: true } } },
      });
      if (viaGrant) {
        const { session, ...grant } = viaGrant;
        return { session, grant };
      }
      const session = await db.authSession.findUnique({
        where: { legacySessionId: legacyId },
        include: { grants: true },
      });
      return session ? { session, grant: null } : null;
    },
  );
}

/** Raw `workflow.user_sessions` row with user + orgMember (the old `getSessionById`). */
export function findLegacySession(id: string): Promise<LegacySessionWithUser | null> {
  return asSystem(
    ['UserSession', 'User', 'OrgMember'],
    'auth resolver: legacy session lookup runs before any tenant context exists',
    () =>
      db.userSession.findUnique({
        where: { id },
        include: { user: { include: { orgMember: true } } },
      }),
  );
}

/** `users` row with orgMemberId=accountId, workspaceId, status ACTIVE, leftAt null. */
export function findActiveMembership(accountId: string, workspaceId: string): Promise<MembershipUser | null> {
  return asSystem(
    ['User'],
    'auth resolver: membership check for a workspace the request is not yet scoped to',
    () =>
      db.user.findFirst({
        where: { orgMemberId: accountId, workspaceId, status: 'ACTIVE', leftAt: null },
        select: MEMBERSHIP_SELECT,
      }),
  );
}

export function findUserById(userId: string): Promise<MembershipUser | null> {
  return asSystem(
    ['User'],
    'auth resolver: principal lookup runs before any tenant context exists',
    () => db.user.findUnique({ where: { id: userId }, select: MEMBERSHIP_SELECT }),
  );
}

export function findOrgMember(memberId: string): Promise<OrgMemberRef | null> {
  return asSystem(
    ['OrgMember'],
    'auth resolver: account lookup runs before any tenant context exists',
    () =>
      db.orgMember.findUnique({
        where: { memberId },
        select: { memberId: true, orgId: true, role: true, leftAt: true },
      }),
  );
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export interface CreateSessionWithGrantInput {
  /** Workspace `users` row the login lands in. */
  user: MembershipUser;
  orgMember: { memberId: string; orgId: string };
  platform: RequestPlatform | 'sdk';
  loginMethod: LoginMethod;
  amr?: string[];
  ip?: string;
  /** JSON string (userAgent, acceptLanguage, timestamp, platform, appVersion). */
  deviceInfo?: string;
  now?: Date;
}

export interface CreateSessionWithGrantResult {
  /** null when the org / flags issued legacy-only. */
  session: AuthSessionWithGrants | null;
  grant: SessionWorkspaceGrant | null;
  legacySession: UserSession;
  /** `xs1_...` or null when legacy-only. */
  sessionToken: string | null;
  sessionExpiresAt: Date;
}

type LegacyRowInput = {
  userId: string;
  workspaceId: string;
  refreshToken: string;
  refreshTokenExpiry: Date;
  deviceInfo?: string;
  ipAddress?: string;
  now: Date;
};

function legacyRowData(input: LegacyRowInput): Prisma.UserSessionUncheckedCreateInput {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    refreshToken: input.refreshToken,
    refreshTokenExpiry: input.refreshTokenExpiry,
    deviceInfo: input.deviceInfo,
    ipAddress: input.ipAddress,
    status: SessionStatus.ACTIVE,
    lastActivity: input.now,
  };
}

function trackLegacyLogin(
  row: Pick<UserSession, 'id' | 'userId'>,
  user: Pick<MembershipUser, 'authProvider'>,
  loginMethod: LoginMethod,
  platform: SessionPlatform,
  extra: Record<string, unknown> = {},
): void {
  void userActivityTrackingService.trackLogin(row.userId, {
    sessionId: row.id,
    method: loginMethod,
    platform: trackPlatform(platform),
    metadata: { authProvider: user.authProvider, ...extra },
  });
}

/**
 * Login issuance. Transaction: legacy row → auth_session → grant, all sharing
 * `legacySessionId`. When the org is issued legacy-only (`effectiveIssuanceModes(orgId).write
 * === 'legacy'`) only the legacy row is created with a fresh deviceKey as `refreshToken`.
 * Failures propagate: a login without a session row is not a login.
 */
export async function createSessionWithGrant(input: CreateSessionWithGrantInput): Promise<CreateSessionWithGrantResult> {
  const now = input.now ?? new Date();
  const flags = getAuthSessionFlags();
  const modes = effectiveIssuanceModes(input.orgMember.orgId, flags);
  const sessionPlatform = toSessionPlatform(input.platform);
  const sessionExpiresAt = sessionExpiryFrom(now);
  const deviceKey = randomUUID();

  if (modes.write === 'legacy') {
    const legacySession = await asSystem(
      ['UserSession'],
      'login issuance (legacy-only org): session row is created on the request that establishes the tenant context',
      () =>
        db.userSession.create({
          data: legacyRowData({
            userId: input.user.id,
            workspaceId: input.user.workspaceId,
            refreshToken: deviceKey,
            refreshTokenExpiry: sessionExpiresAt,
            deviceInfo: input.deviceInfo,
            ipAddress: input.ip,
            now,
          }),
        }),
    );
    trackLegacyLogin(legacySession, input.user, input.loginMethod, sessionPlatform);
    logger.info('[AUTH] [Issuer] legacy-only session created', {
      legacySessionId: legacySession.id,
      userId: input.user.id,
      workspaceId: input.user.workspaceId,
      loginMethod: input.loginMethod,
    });
    return { session: null, grant: null, legacySession, sessionToken: null, sessionExpiresAt };
  }

  const credential = mintSessionCredential(flags.tokenMode);
  const writeLegacy = modes.write !== 'v3';

  const created = await transaction(
    ['UserSession', 'AuthSession', 'SessionWorkspaceGrant'],
    'login issuance: legacy row + auth session + grant are created atomically on the request that establishes the tenant context',
    db,
    async (tx) => {
      // WRITE_MODE=v3 is blocked by validateAuthSessionFlags; the branch exists so the invariant
      // "legacySessionId null ⇔ no legacy row" holds the day it is unblocked.
      const legacySession = writeLegacy
        ? await tx.userSession.create({ data: legacyRowData({ userId: input.user.id, workspaceId: input.user.workspaceId, refreshToken: deviceKey, refreshTokenExpiry: sessionExpiresAt, deviceInfo: input.deviceInfo, ipAddress: input.ip, now }) })
        : null;
      const session = await tx.authSession.create({
        data: {
          id: credential.id,
          accountId: input.orgMember.memberId,
          orgId: input.orgMember.orgId,
          tokenHash: credential.tokenHash,
          legacySessionId: legacySession?.id ?? null,
          deviceKey,
          status: SessionStatus.ACTIVE,
          platform: sessionPlatform,
          aal: 1,
          amr: input.amr ?? [input.loginMethod],
          authenticatedAt: now,
          absoluteExpiry: sessionExpiresAt,
          lastSeenAt: now,
          ipAddress: input.ip ? encrypt(input.ip) : null,
          deviceInfo: input.deviceInfo ? encrypt(input.deviceInfo) : null,
        },
      });
      const grant = await tx.sessionWorkspaceGrant.create({
        data: {
          sessionId: session.id,
          workspaceId: input.user.workspaceId,
          userId: input.user.id,
          legacySessionId: legacySession?.id ?? null,
          grantedAt: now,
        },
      });
      return { session: { ...session, grants: [grant] }, grant, legacySession };
    },
  );

  if (created.legacySession) {
    trackLegacyLogin(created.legacySession, input.user, input.loginMethod, sessionPlatform, { authSessionId: created.session.id });
  }
  logger.info('[AUTH] [Issuer] auth session created', {
    sessionId: created.session.id,
    grantId: created.grant.id,
    legacySessionId: created.legacySession?.id ?? null,
    accountId: input.orgMember.memberId,
    workspaceId: input.user.workspaceId,
    platform: sessionPlatform,
    loginMethod: input.loginMethod,
    tokenMode: flags.tokenMode,
  });
  return {
    session: created.session,
    grant: created.grant,
    // WRITE=v3 would leave this null; blocked by flag validation, and Issuance.legacySessionId is
    // typed non-null, so surface it loudly rather than fabricate an id.
    legacySession: created.legacySession ?? failNoLegacyRow(created.session.id),
    sessionToken: credential.token,
    sessionExpiresAt,
  };
}

function failNoLegacyRow(sessionId: string): never {
  throw new Error(`[auth] auth session ${sessionId} created without a legacy row (AUTH_SESSION_WRITE_MODE=v3 is not supported yet)`);
}

export interface CreateLegacySessionInput {
  user: MembershipUser;
  /** Shared deviceKey / refreshToken of the existing legacy-only session. */
  refreshToken: string;
  refreshTokenExpiry: Date;
  loginMethod: LoginMethod;
  platform: RequestPlatform;
  ip?: string;
  deviceInfo?: string;
  now?: Date;
}

/**
 * Workspace switch for a legacy-only session (org outside AUTH_V3_ORGS or WRITE=legacy): one
 * more `user_sessions` row for the target workspace user, sharing the current row's
 * `refreshToken`. Idempotent per (userId, refreshToken): an ACTIVE row is reused.
 */
export async function createLegacySessionForSwitch(input: CreateLegacySessionInput): Promise<{ row: UserSession; created: boolean }> {
  const now = input.now ?? new Date();
  const result = await asSystem(
    ['UserSession'],
    'workspace switch (legacy-only session): legacy row for the target workspace is written while the ambient context is still the old workspace',
    async () => {
      const existing = await db.userSession.findFirst({
        where: {
          userId: input.user.id,
          refreshToken: input.refreshToken,
          status: SessionStatus.ACTIVE,
          refreshTokenExpiry: { gt: now },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) return { row: existing, created: false };
      const row = await db.userSession.create({
        data: legacyRowData({
          userId: input.user.id,
          workspaceId: input.user.workspaceId,
          refreshToken: input.refreshToken,
          refreshTokenExpiry: input.refreshTokenExpiry,
          deviceInfo: input.deviceInfo,
          ipAddress: input.ip,
          now,
        }),
      });
      return { row, created: true };
    },
  );
  if (result.created) {
    trackLegacyLogin(result.row, input.user, input.loginMethod, toSessionPlatform(input.platform));
  }
  return result;
}

export type AddGrantInputWithMethod = AddGrantInput & { loginMethod?: LoginMethod; now?: Date };

/**
 * Idempotent on `[sessionId, workspaceId]`: an active grant is returned as-is, a revoked one is
 * reactivated (with a fresh legacy row), otherwise a new grant (+ legacy row sharing
 * `refreshToken = session.deviceKey`) is created.
 */
export async function addGrant(input: AddGrantInputWithMethod): Promise<AddGrantResult> {
  const now = input.now ?? new Date();
  const { session, user } = input;
  const flags = getAuthSessionFlags();
  const writeLegacy = flags.writeMode !== 'v3';
  const loginMethod = loginMethodForGrant(input.kind, input.loginMethod);

  const result = await transaction(
    ['SessionWorkspaceGrant', 'UserSession'],
    'grant issuance: adds a workspace grant (+ legacy row) to an account session while the ambient context is another workspace',
    db,
    async (tx) => {
      const existing = await tx.sessionWorkspaceGrant.findUnique({
        where: { sessionId_workspaceId: { sessionId: session.id, workspaceId: user.workspaceId } },
      });
      if (existing && isGrantActive(existing, now)) {
        if (!writeLegacy || existing.legacySessionId) {
          return { grant: existing, legacySessionId: existing.legacySessionId, created: false, legacyRow: null };
        }
        // Grant predates dual-write for this org: give it the legacy row claw expects.
        const legacyRow = await tx.userSession.create({
          data: legacyRowData({ userId: user.id, workspaceId: user.workspaceId, refreshToken: session.deviceKey, refreshTokenExpiry: session.absoluteExpiry, deviceInfo: input.deviceInfo, ipAddress: input.ip, now }),
        });
        const grant = await tx.sessionWorkspaceGrant.update({
          where: { id: existing.id },
          data: { legacySessionId: legacyRow.id, userId: user.id },
        });
        return { grant, legacySessionId: legacyRow.id, created: false, legacyRow };
      }

      const legacyRow = writeLegacy
        ? await tx.userSession.create({
            data: legacyRowData({ userId: user.id, workspaceId: user.workspaceId, refreshToken: session.deviceKey, refreshTokenExpiry: session.absoluteExpiry, deviceInfo: input.deviceInfo, ipAddress: input.ip, now }),
          })
        : null;

      const grant = existing
        ? await tx.sessionWorkspaceGrant.update({
            where: { id: existing.id },
            data: {
              userId: user.id,
              legacySessionId: legacyRow?.id ?? null,
              grantedAt: now,
              expiresAt: null,
              revokedAt: null,
              revokeReason: null,
            },
          })
        : await tx.sessionWorkspaceGrant.create({
            data: {
              sessionId: session.id,
              workspaceId: user.workspaceId,
              userId: user.id,
              legacySessionId: legacyRow?.id ?? null,
              grantedAt: now,
            },
          });
      return { grant, legacySessionId: legacyRow?.id ?? null, created: true, legacyRow };
    },
  );

  if (result.legacyRow) {
    trackLegacyLogin(result.legacyRow, user, loginMethod, session.platform as SessionPlatform, {
      authSessionId: session.id,
      grantKind: input.kind,
    });
  }
  if (result.created) {
    // The resolver mints lazy grants through this repository; switch/create/join are counted by the issuer.
    if (input.kind === 'lazy_grant') {
      recordSessionIssued({ kind: 'lazy_grant', writeMode: flags.writeMode, cookieMode: flags.cookieMode, tokenMode: flags.tokenMode });
    }
    logger.info('[AUTH] [Issuer] grant added', {
      sessionId: session.id,
      grantId: result.grant.id,
      workspaceId: user.workspaceId,
      legacySessionId: result.legacySessionId,
      kind: input.kind,
    });
  }
  return { grant: result.grant, legacySessionId: result.legacySessionId, created: result.created };
}

function legacyIdsOf(session: AuthSessionWithGrants): string[] {
  const ids = new Set<string>();
  if (session.legacySessionId) ids.add(session.legacySessionId);
  for (const g of session.grants) if (g.legacySessionId) ids.add(g.legacySessionId);
  return [...ids];
}

/**
 * Session + every grant → REVOKED; every legacy row of the session (grant ids OR shared
 * deviceKey) → REVOKED; Redis tombstone for the JWT TTL; one LOGOUT activity per live legacy row.
 */
export async function revokeSessionCascade(sessionId: string, reason: string): Promise<void> {
  const now = new Date();
  const session = await findSessionById(sessionId);
  if (!session) {
    logger.warn('[AUTH] [Revoke] session not found', { sessionId, reason });
    return;
  }
  const legacyIds = legacyIdsOf(session);

  const liveLegacy = await transaction(
    ['AuthSession', 'SessionWorkspaceGrant', 'UserSession'],
    'session revocation: cascades across every workspace grant of the account session',
    db,
    async (tx) => {
      const legacyWhere: Prisma.UserSessionWhereInput = {
        status: SessionStatus.ACTIVE,
        OR: [{ id: { in: legacyIds } }, { refreshToken: session.deviceKey }],
      };
      const live = await tx.userSession.findMany({ where: legacyWhere, select: LEGACY_CANDIDATE_SELECT });
      await tx.userSession.updateMany({ where: legacyWhere, data: { status: SessionStatus.REVOKED, updatedAt: now } });
      await tx.sessionWorkspaceGrant.updateMany({
        where: { sessionId: session.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      });
      if (session.status === SessionStatus.ACTIVE) {
        await tx.authSession.update({
          where: { id: session.id },
          data: { status: SessionStatus.REVOKED, revokedAt: now, revokeReason: reason },
        });
      }
      return live;
    },
  );

  await redisRevocationStore.markRevoked(session.id, config.jwt.expirationSeconds);
  for (const row of liveLegacy) userSessionService.trackLogout(row, reason as LogoutReason);
  recordSessionRevoked({ reason, scope: 'session' });
  logger.info('[AUTH] [Revoke] session cascade-revoked', {
    sessionId: session.id,
    accountId: session.accountId,
    reason,
    grants: session.grants.length,
    legacyRowsRevoked: liveLegacy.length,
  });
}

/**
 * Revoke by a legacy `user_sessions` id: cascades through the mapped auth session when one
 * exists (dual-written row), else revokes the single legacy row (pre-backfill / legacy-only org).
 */
export async function revokeByLegacySessionId(legacyId: string, reason: LogoutReason): Promise<{ sessionId: string | null }> {
  const mapped = await findSessionByLegacyId(legacyId);
  if (mapped) {
    await revokeSessionCascade(mapped.session.id, reason);
    return { sessionId: mapped.session.id };
  }
  await asSystem(
    ['UserSession'],
    'logout (legacy-only session): revokes the row on the request that is tearing its own context down',
    () => userSessionService.revokeSession(legacyId, reason),
  );
  recordSessionRevoked({ reason, scope: 'legacy' });
  return { sessionId: null };
}

/** Every ACTIVE session of an account (deactivation, password change/reset). Returns the count. */
export async function revokeAccountSessions(accountId: string, reason: string): Promise<number> {
  const sessions = await asSystem(
    ['AuthSession'],
    'account-wide session revocation: spans every workspace of the account',
    () => db.authSession.findMany({ where: { accountId, status: SessionStatus.ACTIVE }, select: { id: true } }),
  );
  for (const s of sessions) await revokeSessionCascade(s.id, reason);
  if (sessions.length) recordSessionRevoked({ reason, scope: 'account' });
  logger.info('[AUTH] [Revoke] account sessions revoked', { accountId, reason, count: sessions.length });
  return sessions.length;
}

/** One grant → revoked (+ its legacy row). The session and its other grants stay live. */
export async function revokeGrant(grantId: string, reason: string): Promise<void> {
  const now = new Date();
  const legacy = await transaction(
    ['SessionWorkspaceGrant', 'UserSession'],
    'grant revocation: the grant belongs to a workspace the request is not scoped to',
    db,
    async (tx) => {
      const grant = await tx.sessionWorkspaceGrant.findUnique({ where: { id: grantId } });
      if (!grant) return null;
      if (!grant.revokedAt) {
        await tx.sessionWorkspaceGrant.update({ where: { id: grantId }, data: { revokedAt: now, revokeReason: reason } });
      }
      if (!grant.legacySessionId) return null;
      const row = await tx.userSession.findFirst({
        where: { id: grant.legacySessionId, status: SessionStatus.ACTIVE },
        select: LEGACY_CANDIDATE_SELECT,
      });
      if (row) {
        await tx.userSession.update({ where: { id: row.id }, data: { status: SessionStatus.REVOKED, updatedAt: now } });
      }
      return row;
    },
  );
  if (legacy) userSessionService.trackLogout(legacy, reason as LogoutReason);
  recordSessionRevoked({ reason, scope: 'grant' });
}

export function touchLegacyRows(legacySessionIds: string[], now: Date = new Date()): Promise<void> {
  if (!legacySessionIds.length) return Promise.resolve();
  return asSystem(
    ['UserSession'],
    'session touch: legacy rows of one account session live in several workspaces',
    async () => {
      await db.userSession.updateMany({
        where: { id: { in: legacySessionIds }, status: SessionStatus.ACTIVE },
        data: { lastActivity: now, updatedAt: now },
      });
    },
  );
}

export async function touchSession(sessionId: string, legacySessionIds: string[], now: Date = new Date()): Promise<void> {
  await asSystem(
    ['AuthSession'],
    'session touch: lastSeenAt on the account session, before any tenant context exists',
    async () => {
      await db.authSession.updateMany({ where: { id: sessionId, status: SessionStatus.ACTIVE }, data: { lastSeenAt: now } });
    },
  );
  await touchLegacyRows(legacySessionIds, now);
}

export function touchLegacySession(legacySessionId: string, now: Date = new Date()): Promise<void> {
  return touchLegacyRows([legacySessionId], now);
}

/**
 * Cleanup worker step. Expires auth sessions past `absoluteExpiry` (+ their grants), grants past
 * `expiresAt`, and legacy rows past `refreshTokenExpiry`, each capped at `batchSize`.
 */
export async function cleanupExpiredSessions(
  batchSize: number,
  now: Date = new Date(),
): Promise<{ sessionsExpired: number; grantsExpired: number; legacyExpired: number }> {
  const take = Math.max(1, Math.floor(batchSize));
  return asSystem(
    ['AuthSession', 'SessionWorkspaceGrant', 'UserSession'],
    'session cleanup worker: sweeps expired sessions across every org',
    async () => {
      const expiredSessions = await db.authSession.findMany({
        where: { status: SessionStatus.ACTIVE, absoluteExpiry: { lt: now } },
        select: { id: true },
        take,
      });
      const sessionIds = expiredSessions.map((s) => s.id);
      let grantsExpired = 0;
      if (sessionIds.length) {
        const grants = await db.sessionWorkspaceGrant.updateMany({
          where: { sessionId: { in: sessionIds }, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'SESSION_EXPIRED' },
        });
        grantsExpired += grants.count;
        await db.authSession.updateMany({
          where: { id: { in: sessionIds }, status: SessionStatus.ACTIVE },
          data: { status: SessionStatus.EXPIRED },
        });
      }

      const expiredGrants = await db.sessionWorkspaceGrant.findMany({
        where: { revokedAt: null, expiresAt: { lt: now } },
        select: { id: true },
        take,
      });
      if (expiredGrants.length) {
        const r = await db.sessionWorkspaceGrant.updateMany({
          where: { id: { in: expiredGrants.map((g) => g.id) } },
          data: { revokedAt: now, revokeReason: 'GRANT_EXPIRED' },
        });
        grantsExpired += r.count;
      }

      const expiredLegacy = await db.userSession.findMany({
        where: { status: SessionStatus.ACTIVE, refreshTokenExpiry: { lt: now } },
        select: { id: true },
        take,
      });
      let legacyExpired = 0;
      if (expiredLegacy.length) {
        const r = await db.userSession.updateMany({
          where: { id: { in: expiredLegacy.map((s) => s.id) }, status: SessionStatus.ACTIVE },
          data: { status: SessionStatus.EXPIRED, updatedAt: now },
        });
        legacyExpired = r.count;
      }

      return { sessionsExpired: sessionIds.length, grantsExpired, legacyExpired };
    },
  );
}

// ─── Repository facade for the resolver ───────────────────────────────────────

export const authSessionRepository: SessionRepository = {
  findSessionByToken,
  findSessionByLegacyId,
  findLegacySession,
  findActiveMembership,
  findUserById,
  findOrgMember,
  addGrant,
  revokeGrant,
  revokeSessionCascade,
  touchSession,
  touchLegacySession,
};
