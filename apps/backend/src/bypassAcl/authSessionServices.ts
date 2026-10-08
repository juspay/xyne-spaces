/**
 * All DB access for `non_zero.auth_sessions` plus the reads that make a session act in a
 * workspace (`public.users` membership, `org_members`) and the read-only legacy
 * `workflow.user_sessions` paths (conversion on first read, push fallback).
 *
 * Everything here runs before a request has a tenant context (the resolver IS what establishes
 * `req.user`) or spans several workspaces (one session serves every workspace of the account),
 * so every call is an explicit `asSystem` / `transaction` bypass with its table list declared.
 *
 * Legacy table writes are limited to two exceptions: (a) account-wide revokes flip the account's
 * legacy rows to REVOKED (an unconverted legacy cookie must not convert into a fresh ACTIVE row
 * after a password reset); (b) push delivery may null the push columns of a legacy row after FCM
 * reports the token dead. No row is ever inserted or refreshed there.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { SessionStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { encrypt } from '@/services/encryptionService';
import { UserSessionService, resolveSessionPlatform } from '@/services/userSessionService';
import { recordSessionIssued, recordSessionRevoked } from '@/services/otel/authMetrics';
import { redisRevocationStore } from '@/auth/revocation';
import { appVersionFromDeviceInfo, parseLegacyPushToken } from '@/auth/legacyPushToken';
import { S2S_DEVICE_KEY_PREFIX, s2sDeviceKey } from '@/auth/constants';
import { hashToken } from '@/auth/sessionTokens';
import type {
  AuthSessionRow,
  CreateSessionInput,
  LegacySessionWithUser,
  MembershipUser,
  OrgMemberRef,
  PushTarget,
  SessionRepository,
  SessionRevokeReason,
  SetPushTokensInput,
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
} as const;

const ORG_MEMBER_SELECT = { memberId: true, orgId: true, role: true, leftAt: true } as const;

/** Ceiling on a tombstone TTL: the longest-lived JWT any session can mint. */
function maxJwtTtlSeconds(): number {
  return Math.max(config.jwt.expirationSeconds, config.session.workspaceTokenTtlSeconds, config.sdkSso.tokenTtlSeconds);
}

type TombstoneTarget = { id: string; absoluteExpiry?: Date | null };

/**
 * A tombstone only has to outlive the JWTs the session could still have in flight. The TTL is
 * therefore the session's own remaining life, capped by the longest JWT TTL — not the raw TTL
 * read from config, which a deploy that LOWERS `JWT_EXPIRATION_SECONDS` would make too short for
 * tokens minted before it (and needlessly long for a session that expires in a minute).
 */
async function tombstone(targets: TombstoneTarget[], now: Date = new Date()): Promise<void> {
  const ceiling = maxJwtTtlSeconds();
  await Promise.all(
    targets.map((t) => {
      const remaining = t.absoluteExpiry ? Math.ceil((t.absoluteExpiry.getTime() - now.getTime()) / 1000) : ceiling;
      return redisRevocationStore.markRevoked(t.id, Math.max(1, Math.min(ceiling, remaining)));
    }),
  );
}

/**
 * Stamp the account's claims watermark: every access JWT minted before now carries a role / org
 * role / workspace membership that has just changed, so the stateless path must stop trusting it
 * and re-mint from the session. Called by the writers of those fields, never on a read path.
 */
export async function markAccountClaimsStale(accountId: string, at: Date = new Date()): Promise<void> {
  await redisRevocationStore.markClaimsStale(accountId, maxJwtTtlSeconds(), at);
  logger.info('[AUTH] claims watermark stamped', { accountId, at: at.toISOString() });
}

/**
 * Same stamp, for writers that hold a `users.id` rather than the account id (status flips,
 * workspace-role writes). Best-effort: a missing row or a user with no org member means there is
 * no account to invalidate, and failing the caller's write over a metrics-grade Redis key would be
 * the wrong trade.
 */
export async function markClaimsStaleForUser(userId: string, at: Date = new Date()): Promise<void> {
  try {
    const row = await asSystem(['User'], 'claims watermark lookup: maps a workspace user to its account, no tenant context', () =>
      db.user.findUnique({ where: { id: userId }, select: { orgMemberId: true } }),
    );
    if (row?.orgMemberId) await markAccountClaimsStale(row.orgMemberId, at);
  } catch (error) {
    logger.warn('[AUTH] claims watermark stamp failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export function findByTokenHash(tokenHash: string): Promise<AuthSessionRow | null> {
  return asSystem(['AuthSession'], 'session resolve: runs before the tenant context exists', () =>
    db.authSession.findUnique({ where: { tokenHash } }),
  );
}

export function findById(sessionId: string): Promise<AuthSessionRow | null> {
  return asSystem(['AuthSession'], 'session resolve by id (JWT sid / token endpoints): no tenant context yet', () =>
    db.authSession.findUnique({ where: { id: sessionId } }),
  );
}

export function findLegacyRowForConversion(legacyId: string): Promise<LegacySessionWithUser | null> {
  return asSystem(['UserSession', 'User', 'OrgMember'], 'legacy session read for conversion: runs before the tenant context exists', () =>
    db.userSession.findUnique({
      where: { id: legacyId },
      include: { user: { include: { orgMember: true } } },
    }),
  );
}

export function findMembership(accountId: string, workspaceId: string): Promise<MembershipUser | null> {
  return asSystem(['User'], 'membership read for the requested workspace: the resolver establishes the tenant context', () =>
    db.user.findFirst({
      where: { orgMemberId: accountId, workspaceId, status: 'ACTIVE', leftAt: null },
      select: MEMBERSHIP_SELECT,
    }),
  );
}

export function findUserById(userId: string): Promise<MembershipUser | null> {
  return asSystem(['User'], 'user read by id for JWT / token paths: runs before the tenant context exists', () =>
    db.user.findUnique({ where: { id: userId }, select: MEMBERSHIP_SELECT }),
  );
}

export function findOrgMember(memberId: string): Promise<OrgMemberRef | null> {
  return asSystem(['OrgMember'], 'org member read for the session principal: no tenant context yet', () =>
    db.orgMember.findUnique({ where: { memberId }, select: ORG_MEMBER_SELECT }),
  );
}

/**
 * Is the account signed in on a real device anywhere? Two deliberate adjustments:
 *   - S2S rows (`s2s:` deviceKey) do not count. They are created BY the token endpoint, so
 *     counting them would make the first mint keep answering "yes" long after the user logged out.
 *   - never-converted legacy `workflow.user_sessions` rows do count. An account that logged in
 *     before the deploy and has not made a request since has no `auth_sessions` row yet, and
 *     background work for that user (claw agents, webhooks, scheduled jobs) must not stop.
 */
export function hasActiveSession(accountId: string, now: Date = new Date()): Promise<boolean> {
  return asSystem(['AuthSession', 'UserSession', 'User'], 'account liveness check (internal token endpoint): spans every workspace', async () => {
    const n = await db.authSession.count({
      where: {
        accountId,
        status: SessionStatus.ACTIVE,
        absoluteExpiry: { gt: now },
        NOT: { deviceKey: { startsWith: S2S_DEVICE_KEY_PREFIX } },
      },
    });
    if (n > 0) return true;
    return userSessionService.hasActiveSessionForAccount(accountId, now);
  });
}

// ─── Create / convert ─────────────────────────────────────────────────────────

/**
 * Other ACTIVE rows carrying the same deviceKey are revoked first (one account per device,
 * matching the single legacy cookie), then the row is inserted.
 */
export async function createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
  const { created, revokedIds } = await transaction(
    ['AuthSession'],
    'session issuance: created on the request that establishes the tenant context; one ACTIVE row per device',
    db,
    async (tx) => {
      const prior = await tx.authSession.findMany({
        where: { deviceKey: input.deviceKey, status: SessionStatus.ACTIVE },
        select: { id: true, absoluteExpiry: true },
      });
      const revokedIds = prior;
      if (revokedIds.length > 0) {
        await tx.authSession.updateMany({
          where: { id: { in: revokedIds.map((p) => p.id) } },
          data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokeReason: 'DEVICE_REUSED' },
        });
      }
      const created = await tx.authSession.create({
        data: {
          accountId: input.accountId,
          orgId: input.orgId,
          tokenHash: input.tokenHash,
          deviceKey: input.deviceKey,
          platform: input.platform,
          absoluteExpiry: input.absoluteExpiry,
          deviceInfo: input.deviceInfo ?? null,
          appVersion: input.appVersion ?? null,
          status: SessionStatus.ACTIVE,
        },
      });
      return { created, revokedIds };
    },
  );
  if (revokedIds.length > 0) {
    await tombstone(revokedIds);
    recordSessionRevoked({ reason: 'DEVICE_REUSED', scope: 'session' });
    logger.info('[AUTH] device reused: prior sessions revoked', { count: revokedIds.length, platform: input.platform });
  }
  recordSessionIssued({ kind: input.issuedKind ?? 'login', platform: input.platform });
  return created;
}

/**
 * Insert the `auth_sessions` row for a legacy `workflow.user_sessions` row. Idempotent: a P2002
 * (two concurrent first requests, or the legacy deviceId already held by an ACTIVE row) re-reads
 * by tokenHash / legacySessionId and, failing that, retries once with a fresh deviceKey. The
 * legacy row itself is never written.
 */
export async function convertLegacySession(input: { legacy: LegacySessionWithUser; tokenHash: string }): Promise<AuthSessionRow> {
  const { legacy, tokenHash } = input;
  const orgMember = legacy.user.orgMember;
  if (!orgMember) throw new Error('convertLegacySession: legacy session user has no org member');

  const fcm = parseLegacyPushToken(legacy.fcmToken);
  const voip = parseLegacyPushToken(legacy.voipToken);
  const base = {
    accountId: orgMember.memberId,
    orgId: orgMember.orgId,
    tokenHash,
    legacySessionId: legacy.id,
    platform: resolveSessionPlatform(legacy.deviceInfo),
    absoluteExpiry: legacy.refreshTokenExpiry,
    deviceInfo: legacy.deviceInfo ? encrypt(legacy.deviceInfo) : null,
    fcmToken: fcm?.token ?? null,
    voipToken: voip?.token ?? null,
    pushPlatform: fcm?.platform ?? voip?.platform ?? null,
    appVersion: appVersionFromDeviceInfo(legacy.deviceInfo) ?? null,
    status: SessionStatus.ACTIVE,
  };

  return asSystem(['AuthSession'], 'legacy session conversion on first read: runs before the tenant context exists', async () => {
    const attempt = async (deviceKey: string, clearTokens: boolean): Promise<AuthSessionRow | null> => {
      try {
        return await db.authSession.create({
          data: { ...base, deviceKey, ...(clearTokens ? { fcmToken: null, voipToken: null } : {}) },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return null;
      }
    };

    const first = await attempt(legacy.deviceId ?? randomUUID(), false);
    if (first) {
      recordSessionIssued({ kind: 'legacy_convert', platform: first.platform });
      return first;
    }
    // Lost a race (same cookie presented twice) → the row exists.
    const existing =
      (await db.authSession.findUnique({ where: { tokenHash } })) ??
      (await db.authSession.findUnique({ where: { legacySessionId: legacy.id } }));
    if (existing) return existing;
    // Otherwise the legacy deviceId or push token is already held by another ACTIVE row
    // (same phone, another workspace row): keep the session, drop the duplicate identity.
    const retry = await attempt(randomUUID(), true);
    if (retry) {
      recordSessionIssued({ kind: 'legacy_convert', platform: retry.platform });
      return retry;
    }
    const last =
      (await db.authSession.findUnique({ where: { tokenHash } })) ??
      (await db.authSession.findUnique({ where: { legacySessionId: legacy.id } }));
    if (!last) throw new Error('convertLegacySession: unique violation without a matching row');
    return last;
  });
}

// ─── Revoke / expire ──────────────────────────────────────────────────────────

export async function revokeSession(sessionId: string, reason: SessionRevokeReason): Promise<void> {
  const row = await asSystem(['AuthSession'], 'session revoke: logout / membership loss, before or without a tenant context', async () => {
    const r = await db.authSession.updateMany({
      where: { id: sessionId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokeReason: reason },
    });
    if (r.count === 0) return null;
    return db.authSession.findUnique({ where: { id: sessionId }, select: { id: true, absoluteExpiry: true } });
  });
  if (row) {
    await tombstone([row]);
    recordSessionRevoked({ reason, scope: 'session' });
  }
}

/**
 * Every ACTIVE session of the account → REVOKED, plus legacy exception (a): the account's
 * never-converted legacy rows are flipped to REVOKED too.
 */
export async function revokeAccountSessions(accountId: string, reason: SessionRevokeReason): Promise<number> {
  const { ids, userIds } = await asSystem(
    ['AuthSession', 'User'],
    'account-wide revoke (password change / reset / deactivation / member left): spans every workspace',
    async () => {
      const live = await db.authSession.findMany({
        where: { accountId, status: SessionStatus.ACTIVE },
        select: { id: true, absoluteExpiry: true },
      });
      const ids = live;
      if (ids.length > 0) {
        await db.authSession.updateMany({
          where: { id: { in: ids.map((s) => s.id) } },
          data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokeReason: reason },
        });
      }
      const users = await db.user.findMany({ where: { orgMemberId: accountId }, select: { id: true } });
      return { ids, userIds: users.map((u) => u.id) };
    },
  );
  if (ids.length > 0) {
    await tombstone(ids);
    recordSessionRevoked({ reason, scope: 'account' });
  }
  // Legacy exception (a): status-only flips on workflow.user_sessions.
  await asSystem(['UserSession'], 'account-wide revoke: unconverted legacy rows must not convert into ACTIVE sessions later', async () => {
    for (const userId of userIds) {
      await userSessionService.revokeAllUserSessions(userId, reason);
    }
  });
  if (userIds.length > 0) recordSessionRevoked({ reason, scope: 'legacy' });
  return ids.length;
}

/**
 * Cleanup worker step: ACTIVE rows past absoluteExpiry → EXPIRED, at most `batchSize`.
 *
 * Expiring a row is a revocation as far as outstanding tokens are concerned: a JWT minted in the
 * last seconds before `absoluteExpiry` stays signature-valid for a whole JWT TTL afterwards, so the
 * ids are tombstoned exactly like a logout — at the full JWT ceiling, since the row's own remaining
 * life (the clamp `tombstone` applies elsewhere) is by definition already spent here.
 */
export async function expireSessions(batchSize: number, now: Date): Promise<number> {
  const take = Math.max(1, Math.floor(batchSize));
  const { count, expired } = await asSystem(
    ['AuthSession'],
    'session cleanup worker: expires sessions past absoluteExpiry across every org',
    async () => {
      const rows = await db.authSession.findMany({
        where: { status: SessionStatus.ACTIVE, absoluteExpiry: { lt: now } },
        select: { id: true, absoluteExpiry: true },
        orderBy: { absoluteExpiry: 'asc' },
        take,
      });
      if (rows.length === 0) return { count: 0, expired: [] as TombstoneTarget[] };
      const r = await db.authSession.updateMany({
        where: { id: { in: rows.map((x) => x.id) }, status: SessionStatus.ACTIVE },
        data: { status: SessionStatus.EXPIRED, revokedAt: now, revokeReason: 'EXPIRED' },
      });
      return { count: r.count, expired: rows };
    },
  );
  if (expired.length > 0) {
    // The JWT ceiling, not the (already elapsed) row lifetime: these tokens are the ones still in flight.
    await Promise.all(expired.map((row) => redisRevocationStore.markRevoked(row.id, maxJwtTtlSeconds())));
    recordSessionRevoked({ reason: 'EXPIRED', scope: 'session' });
  }
  return count;
}

/**
 * Mobile sessions that never registered a push token — the constraint the DB cannot express.
 * Counted once per cleanup run (a fleet-wide snapshot), NOT per push delivery: counting it there
 * put a slowly-changing state on the notification-volume clock, so the number said more about how
 * chatty the workspace was than about how many phones were unreachable.
 */
export function countTokenlessMobileSessions(now: Date = new Date()): Promise<number> {
  return asSystem(['AuthSession'], 'push-token coverage snapshot for the cleanup worker: spans every org', () =>
    db.authSession.count({
      where: { status: SessionStatus.ACTIVE, absoluteExpiry: { gt: now }, platform: 'MOBILE', fcmToken: null },
    }),
  );
}

/**
 * The one long-lived row that server-to-server tokens for this account are pinned to.
 *
 * Deliberately not a device session: a user logging out on one phone must not tombstone the token
 * a background job (claw agent, webhook, scheduled run) is holding, while an account-wide revoke
 * (password reset, member removed) must kill it. Reused while ACTIVE and not about to expire, so a
 * burst of mints costs one row, and `hasActiveSession` ignores it so it can never stand in for a
 * real login.
 */
export async function ensureServiceSession(accountId: string, orgId: string, now: Date = new Date()): Promise<AuthSessionRow> {
  const deviceKey = s2sDeviceKey(accountId);
  // Must outlive any token minted from it; one session lifetime, re-created when close to the edge.
  const minRemainingMs = maxJwtTtlSeconds() * 1000;
  const existing = await asSystem(['AuthSession'], 'S2S session lookup: minted for background services, spans every workspace', () =>
    db.authSession.findFirst({
      where: {
        accountId,
        deviceKey,
        status: SessionStatus.ACTIVE,
        absoluteExpiry: { gt: new Date(now.getTime() + minRemainingMs) },
      },
    }),
  );
  if (existing) return existing;
  try {
    // Rolling over revokes (and tombstones) the previous S2S row, so tokens still cached from it die
    // early — once per session lifetime per account, and claw-auth's one-shot 401 retry re-mints, so
    // the worst case is a single retried call rather than a failed job.
    return await createSession({
      accountId,
      orgId,
      // No client ever presents this token, so the hash is of a value nobody holds.
      tokenHash: hashToken(`s2s:${randomUUID()}`),
      deviceKey,
      platform: 'SDK',
      absoluteExpiry: new Date(now.getTime() + config.session.expiryDays * 24 * 60 * 60 * 1000),
      deviceInfo: null,
      appVersion: null,
      issuedKind: 'sdk',
    });
  } catch (error) {
    // Two concurrent mints for the same account (two workspaces, or two claw pods) race on the
    // partial unique "one ACTIVE row per deviceKey": the loser gets P2002. The winner's row is
    // exactly what this function was asked for, so re-read it instead of failing the request —
    // the same shape as `convertLegacySession`'s idempotency.
    if (!isUniqueViolation(error)) throw error;
    const winner = await asSystem(['AuthSession'], 'S2S session re-read after a concurrent insert lost the unique race', () =>
      db.authSession.findFirst({ where: { accountId, deviceKey, status: SessionStatus.ACTIVE } }),
    );
    if (!winner) throw error;
    logger.info('[AUTH] S2S session insert lost the race; reusing the winner', { accountId, sessionId: winner.id });
    return winner;
  }
}

// ─── Device key ───────────────────────────────────────────────────────────────

/**
 * Inside an open transaction: make `deviceKey` the row's device key. Other ACTIVE rows holding that
 * key are revoked first (one ACTIVE session per device; the partial unique would otherwise reject
 * the update). Returns the ids revoked so the caller can tombstone them after commit.
 */
async function adoptDeviceKeyInTx(
  tx: Prisma.TransactionClient,
  own: { id: string; deviceKey: string },
  deviceKey: string,
): Promise<TombstoneTarget[]> {
  if (deviceKey === own.deviceKey) return [];
  const others = await tx.authSession.findMany({
    where: { deviceKey, status: SessionStatus.ACTIVE, id: { not: own.id } },
    select: { id: true, absoluteExpiry: true },
  });
  const revokedIds = others;
  if (revokedIds.length > 0) {
    await tx.authSession.updateMany({
      where: { id: { in: revokedIds.map((o) => o.id) } },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date(), revokeReason: 'DEVICE_REUSED' },
    });
  }
  await tx.authSession.update({ where: { id: own.id }, data: { deviceKey } });
  return revokedIds;
}

async function afterDeviceReuse(revokedIds: TombstoneTarget[], context: string): Promise<void> {
  if (revokedIds.length === 0) return;
  await tombstone(revokedIds);
  recordSessionRevoked({ reason: 'DEVICE_REUSED', scope: 'session' });
  logger.info('[AUTH] device reused: prior sessions revoked', { count: revokedIds.length, context });
}

/**
 * A client-owned stable device id (`x-device-id` on refresh-session, Electron clientSessionId,
 * mobile deviceRegistry uuid) becomes the row's deviceKey. Guarded by accountId: false when the
 * row is not the caller's ACTIVE session.
 */
export async function adoptDeviceKey(sessionId: string, accountId: string, deviceKey: string): Promise<boolean> {
  const { updated, revokedIds } = await transaction(
    ['AuthSession'],
    'device key adoption: one ACTIVE session per device, rows span every workspace of the account',
    db,
    async (tx) => {
      const own = await tx.authSession.findFirst({
        where: { id: sessionId, accountId, status: SessionStatus.ACTIVE },
        select: { id: true, deviceKey: true },
      });
      if (!own) return { updated: false, revokedIds: [] as TombstoneTarget[] };
      const revokedIds = await adoptDeviceKeyInTx(tx, own, deviceKey);
      return { updated: true, revokedIds };
    },
  );
  await afterDeviceReuse(revokedIds, 'adoptDeviceKey');
  return updated;
}

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Register push tokens on the caller's own session row. In one transaction: the same tokens are
 * nulled on any other ACTIVE row (partial unique), a client-supplied stable deviceId becomes the
 * row's deviceKey (revoking other ACTIVE rows of that device), then the row is updated. Returns
 * false when the row is not the caller's (guarded by accountId).
 */
export async function setPushTokens(input: SetPushTokensInput): Promise<boolean> {
  const { updated, revokedIds } = await transaction(
    ['AuthSession'],
    'push token register: tokens are unique across ACTIVE sessions, which span every workspace',
    db,
    async (tx) => {
      const own = await tx.authSession.findFirst({
        where: { id: input.sessionId, accountId: input.accountId, status: SessionStatus.ACTIVE },
        select: { id: true, deviceKey: true },
      });
      if (!own) return { updated: false, revokedIds: [] as TombstoneTarget[] };

      await tx.authSession.updateMany({
        where: { id: { not: own.id }, status: SessionStatus.ACTIVE, fcmToken: input.fcmToken },
        data: { fcmToken: null },
      });
      if (input.voipToken) {
        await tx.authSession.updateMany({
          where: { id: { not: own.id }, status: SessionStatus.ACTIVE, voipToken: input.voipToken },
          data: { voipToken: null },
        });
      }

      const revokedIds = input.deviceId ? await adoptDeviceKeyInTx(tx, own, input.deviceId) : [];

      await tx.authSession.update({
        where: { id: own.id },
        data: {
          fcmToken: input.fcmToken,
          voipToken: input.voipToken,
          pushPlatform: input.pushPlatform,
          appVersion: input.appVersion ?? undefined,
        },
      });
      return { updated: true, revokedIds };
    },
  );
  await afterDeviceReuse(revokedIds, 'setPushTokens');
  return updated;
}

export function clearPushTokens(sessionId: string): Promise<void> {
  return asSystem(['AuthSession'], 'push token clear (unregister / FCM UNREGISTERED): worker context has no tenant', async () => {
    await db.authSession.updateMany({ where: { id: sessionId }, data: { fcmToken: null, voipToken: null } });
  });
}

/**
 * Deliverable push endpoints of an account: ACTIVE unexpired session rows with a token, then the
 * legacy fallback rows of the account's workspace users (until converted / expired). Deduped by
 * token; session rows win.
 */
export function findPushTargetsForAccount(accountId: string, now: Date = new Date()): Promise<PushTarget[]> {
  return asSystem(
    ['AuthSession', 'UserSession', 'User'],
    'push delivery: devices are owned by the account, which spans every workspace (workers run without tenant context)',
    async () => {
      const rows = await db.authSession.findMany({
        where: { accountId, status: SessionStatus.ACTIVE, absoluteExpiry: { gt: now }, fcmToken: { not: null } },
        select: { id: true, fcmToken: true, voipToken: true, pushPlatform: true, appVersion: true },
        orderBy: { updatedAt: 'desc' },
      });
      const targets: PushTarget[] = rows
        .filter((r): r is typeof r & { fcmToken: string } => !!r.fcmToken)
        .map((r) => ({
          id: r.id,
          source: 'session' as const,
          token: r.fcmToken,
          voipToken: r.voipToken ?? undefined,
          platform: (r.pushPlatform as PushTarget['platform'] | null) ?? 'unknown',
          appVersion: r.appVersion ?? undefined,
        }));

      const legacyRows = await userSessionService.findLegacyPushRowsForAccount(accountId, now);
      for (const row of legacyRows) {
        const fcm = parseLegacyPushToken(row.fcmToken);
        if (!fcm) continue;
        const voip = parseLegacyPushToken(row.voipToken);
        targets.push({
          id: row.id,
          source: 'legacy',
          token: fcm.token,
          voipToken: voip?.token,
          platform: fcm.platform !== 'unknown' ? fcm.platform : voip?.platform ?? 'unknown',
          appVersion: appVersionFromDeviceInfo(row.deviceInfo),
        });
      }

      const seen = new Set<string>();
      return targets.filter((t) => (seen.has(t.token) ? false : (seen.add(t.token), true)));
    },
  );
}

/** Legacy exception (b): null the push columns of one legacy row after FCM reports the token dead. */
export function nullLegacyPushColumns(legacySessionId: string): Promise<void> {
  return asSystem(['UserSession'], 'legacy push columns cleared after FCM UNREGISTERED (worker context, no tenant)', async () => {
    await db.userSession.updateMany({
      where: { id: legacySessionId },
      data: { fcmToken: null, voipToken: null },
    });
  });
}

// ─── Repository facade ────────────────────────────────────────────────────────

export const authSessionRepository: SessionRepository = {
  findByTokenHash,
  findById,
  findLegacyRowForConversion,
  convertLegacySession,
  createSession,
  findMembership,
  findUserById,
  findOrgMember,
  revokeSession,
  revokeAccountSessions,
  hasActiveSession,
  expireSessions,
  ensureServiceSession,
  adoptDeviceKey,
  setPushTokens,
  clearPushTokens,
  findPushTargetsForAccount,
  nullLegacyPushColumns,
};
