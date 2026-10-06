/**
 * One-off backfill: mint `auth_sessions` + `session_workspace_grants` for every live legacy
 * `workflow.user_sessions` row that has no grant yet, so READ_MODE can move past
 * `v3_with_legacy_fallback` without logging anyone out.
 *
 * Spans every workspace and org by design (a device session is account-level), which is what
 * the system actor is for: `db` is the ACL-wrapped client and an ordinary request context would
 * silently narrow every query to the calling admin's workspace.
 *
 * Idempotent: a re-run attaches to the ACTIVE session with the same accountId+deviceKey, and
 * the unique constraints (`auth_sessions.legacySessionId`, `grants.legacySessionId`,
 * `grants(sessionId, workspaceId)`) turn any race into a counted P2002 skip.
 */
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { encrypt } from '@/services/encryptionService';
import { getAuthSessionFlags, isV3Org } from '@/auth/flags';
import {
  groupLegacyRows,
  primaryRowsPerWorkspace,
  type BackfillGroup,
  type LegacyBackfillRow,
} from '@/auth/backfillGrouping';
import type { SessionPlatform } from '@/auth/types';
import { recordSessionIssued } from '@/services/otel/authMetrics';
import { asSystem } from './base';

const TAG = '[AuthSessionBackfill]';

const LEGACY_ACTIVE = 'ACTIVE';
const SESSION_ACTIVE = 'ACTIVE';
const USER_ACTIVE = 'ACTIVE';
/** Page size for the status counters (ids only). */
const STATUS_PAGE_SIZE = 1000;

export interface AuthSessionBackfillOptions {
  batchSize: number;
  delayMs: number;
  maxBatches: number;
  dryRun: boolean;
  cursor: string | null;
  allOrgs: boolean;
}

export interface AuthSessionBackfillBatchCounts {
  scanned: number;
  sessionsCreated: number;
  sessionsAttached: number;
  grantsCreated: number;
  skipped: number;
  errors: number;
}

export interface AuthSessionBackfillBatch extends AuthSessionBackfillBatchCounts {
  batch: number;
  nextCursor: string | null;
}

export interface AuthSessionBackfillResult {
  batches: AuthSessionBackfillBatch[];
  totals: AuthSessionBackfillBatchCounts;
  done: boolean;
  nextCursor: string | null;
  dryRun: boolean;
  allOrgs: boolean;
  durationMs: number;
}

export interface AuthSessionBackfillStatus {
  /** ACTIVE legacy rows whose refreshToken has not expired. */
  legacyActive: number;
  /** Of those, rows some grant already points at. */
  mapped: number;
  remaining: number;
  authSessions: number;
  grants: number;
}

type CandidateUser = {
  id: string;
  orgMemberId: string | null;
  workspaceId: string;
  status: string;
  leftAt: Date | null;
  authProvider: string;
  workspace: { orgId: string } | null;
};

const legacyRowSelect = {
  id: true,
  userId: true,
  workspaceId: true,
  refreshToken: true,
  refreshTokenExpiry: true,
  createdAt: true,
  lastActivity: true,
  deviceInfo: true,
  ipAddress: true,
} as const;

function liveLegacyWhere(now: Date): Prisma.UserSessionWhereInput {
  return { status: LEGACY_ACTIVE, refreshTokenExpiry: { gt: now } };
}

function emptyCounts(): AuthSessionBackfillBatchCounts {
  return { scanned: 0, sessionsCreated: 0, sessionsAttached: 0, grantsCreated: 0, skipped: 0, errors: 0 };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Same heuristic as userSessionService.resolveSessionPlatform: legacy rows have no platform
 * column, so recover it from the deviceInfo JSON (explicit `platform` key, then user agent).
 */
export function resolveSessionPlatform(deviceInfo: string | null | undefined): SessionPlatform {
  let hint = '';
  let userAgent = '';
  if (deviceInfo) {
    try {
      const parsed = JSON.parse(deviceInfo) as { platform?: unknown; userAgent?: unknown };
      if (typeof parsed.platform === 'string') hint = parsed.platform.toLowerCase();
      if (typeof parsed.userAgent === 'string') userAgent = parsed.userAgent.toLowerCase();
    } catch {
      // deviceInfo is best-effort JSON
    }
  }
  if (hint === 'electron' || userAgent.includes('electron')) return 'ELECTRON';
  if (hint === 'mobile' || userAgent.includes('mobile')) return 'MOBILE';
  return 'WEB';
}

function encryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return encrypt(value);
  } catch (error) {
    logger.warn(`${TAG} could not encrypt session metadata; storing null`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Ids among `ids` that some grant already points at. */
async function findMappedLegacyIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const grants = await db.sessionWorkspaceGrant.findMany({
    where: { legacySessionId: { in: ids } },
    select: { legacySessionId: true },
  });
  return new Set(grants.map((g) => g.legacySessionId).filter((id): id is string => !!id));
}

/**
 * A user may act for a grant when the workspace membership is live and it belongs to an
 * account. Returns the reason to skip, or null.
 */
function userSkipReason(user: CandidateUser | undefined): string | null {
  if (!user) return 'user_not_found';
  if (user.status !== USER_ACTIVE) return 'user_inactive';
  if (user.leftAt) return 'user_left';
  if (!user.orgMemberId) return 'no_org_member';
  if (!user.workspace?.orgId) return 'no_workspace_org';
  return null;
}

/**
 * Resolve one grouped device session into writes. Pure apart from the DB reads/writes it
 * delegates, so every skip is counted with its reason in the log.
 */
async function processGroup(
  group: BackfillGroup,
  usersById: Map<string, CandidateUser>,
  alreadyMapped: Set<string>,
  options: AuthSessionBackfillOptions,
  counts: AuthSessionBackfillBatchCounts,
): Promise<void> {
  // Drop rows whose workspace user cannot carry a grant, then regroup so the anchor row
  // (legacySessionId / authenticatedAt) is the earliest row that is actually eligible.
  const eligible: LegacyBackfillRow[] = [];
  for (const row of group.rows) {
    const reason = userSkipReason(usersById.get(row.userId));
    if (reason) {
      counts.skipped += 1;
      logger.debug(`${TAG} skip row`, { legacySessionId: row.id, reason });
      continue;
    }
    eligible.push(row);
  }
  if (eligible.length === 0) return;

  const [g] = groupLegacyRows(eligible);
  const anchorUser = usersById.get(g.rows[0].userId) as CandidateUser;
  const accountId = anchorUser.orgMemberId as string;
  const orgId = anchorUser.workspace?.orgId as string;

  if (!options.allOrgs && !isV3Org(orgId)) {
    counts.skipped += g.rows.length;
    logger.debug(`${TAG} skip group: org not in AUTH_V3_ORGS`, { orgId, legacySessionId: g.legacySessionId });
    return;
  }

  // Rows of one device all belong to one account; anything else is data drift — leave it.
  const primaries = primaryRowsPerWorkspace(g).filter((row) => {
    const u = usersById.get(row.userId);
    if (u?.orgMemberId === accountId) return true;
    counts.skipped += 1;
    logger.warn(`${TAG} skip row: account mismatch inside one device group`, {
      legacySessionId: row.id,
      expectedAccountId: accountId,
      rowAccountId: u?.orgMemberId ?? null,
    });
    return false;
  });
  // Superseded duplicates (same workspace, later row) carry no grant of their own.
  counts.skipped += g.rows.length - primaries.length;

  const grantsToCreate = primaries.filter((row) => !alreadyMapped.has(row.id));
  if (grantsToCreate.length === 0) {
    counts.skipped += primaries.length;
    return;
  }

  let session = await db.authSession.findFirst({
    where: { accountId, deviceKey: g.deviceKey, status: SESSION_ACTIVE },
    select: { id: true },
  });

  if (session) {
    counts.sessionsAttached += 1;
  } else if (options.dryRun) {
    counts.sessionsCreated += 1;
    counts.grantsCreated += grantsToCreate.length;
    return;
  } else {
    const anchor = g.rows[0];
    try {
      session = await db.authSession.create({
        data: {
          accountId,
          orgId,
          tokenHash: null,
          legacySessionId: g.legacySessionId,
          deviceKey: g.deviceKey,
          status: SESSION_ACTIVE,
          platform: resolveSessionPlatform(anchor.deviceInfo),
          aal: 1,
          amr: [anchorUser.authProvider],
          authenticatedAt: g.authenticatedAt,
          absoluteExpiry: g.absoluteExpiry,
          lastSeenAt: g.lastSeenAt,
          ipAddress: encryptOrNull(anchor.ipAddress),
          deviceInfo: encryptOrNull(anchor.deviceInfo),
        },
        select: { id: true },
      });
      counts.sessionsCreated += 1;
      const flags = getAuthSessionFlags();
      recordSessionIssued({
        kind: 'backfill',
        writeMode: flags.writeMode,
        cookieMode: flags.cookieMode,
        tokenMode: flags.tokenMode,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race (or the anchor row was mapped as a session elsewhere): reuse that session.
      counts.skipped += 1;
      session =
        (await db.authSession.findFirst({
          where: { accountId, deviceKey: g.deviceKey, status: SESSION_ACTIVE },
          select: { id: true },
        })) ??
        (await db.authSession.findUnique({
          where: { legacySessionId: g.legacySessionId },
          select: { id: true },
        }));
      if (!session) {
        logger.warn(`${TAG} P2002 on session create but no session found to attach`, {
          legacySessionId: g.legacySessionId,
          accountId,
        });
        counts.errors += 1;
        return;
      }
    }
  }

  if (options.dryRun) {
    counts.grantsCreated += grantsToCreate.length;
    return;
  }

  for (const row of grantsToCreate) {
    try {
      await db.sessionWorkspaceGrant.create({
        data: {
          sessionId: session.id,
          workspaceId: row.workspaceId,
          userId: row.userId,
          legacySessionId: row.id,
          grantedAt: row.createdAt,
        },
        select: { id: true },
      });
      counts.grantsCreated += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      counts.skipped += 1;
      logger.debug(`${TAG} grant exists`, { legacySessionId: row.id, sessionId: session.id, workspaceId: row.workspaceId });
    }
  }
}

/**
 * One keyset page of unmapped live legacy rows, widened to the full device group of each row
 * (`refreshToken in …`) so the anchor row is always the earliest row even when it fell on an
 * earlier page — in which case its session already exists and the rows attach to it.
 */
async function runBatch(
  cursor: string | null,
  options: AuthSessionBackfillOptions,
  now: Date,
): Promise<{ counts: AuthSessionBackfillBatchCounts; nextCursor: string | null; exhausted: boolean }> {
  const counts = emptyCounts();

  const page = await db.userSession.findMany({
    where: { ...liveLegacyWhere(now), ...(cursor ? { id: { gt: cursor } } : {}) },
    select: legacyRowSelect,
    orderBy: { id: 'asc' },
    take: options.batchSize,
  });
  counts.scanned = page.length;
  if (page.length === 0) return { counts, nextCursor: cursor, exhausted: true };

  const nextCursor = page[page.length - 1].id;
  const exhausted = page.length < options.batchSize;

  const mappedInPage = await findMappedLegacyIds(page.map((r) => r.id));
  const candidates = page.filter((r) => !mappedInPage.has(r.id));
  counts.skipped += page.length - candidates.length;
  if (candidates.length === 0) return { counts, nextCursor, exhausted };

  const tokens = [...new Set(candidates.map((r) => r.refreshToken))];
  const groupRows = await db.userSession.findMany({
    where: { ...liveLegacyWhere(now), refreshToken: { in: tokens } },
    select: legacyRowSelect,
  });
  const groups = groupLegacyRows(groupRows);

  const alreadyMapped = await findMappedLegacyIds(groupRows.map((r) => r.id));

  const userIds = [...new Set(groupRows.map((r) => r.userId))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      orgMemberId: true,
      workspaceId: true,
      status: true,
      leftAt: true,
      authProvider: true,
      workspace: { select: { orgId: true } },
    },
  });
  const usersById = new Map<string, CandidateUser>(users.map((u) => [u.id, u]));

  for (const group of groups) {
    try {
      await processGroup(group, usersById, alreadyMapped, options, counts);
    } catch (error) {
      counts.errors += 1;
      logger.error(`${TAG} group failed`, {
        legacySessionId: group.legacySessionId,
        rows: group.rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { counts, nextCursor, exhausted };
}

export function runAuthSessionBackfill(options: AuthSessionBackfillOptions): Promise<AuthSessionBackfillResult> {
  return asSystem(
    ['UserSession', 'SessionWorkspaceGrant', 'AuthSession', 'User', 'Workspace'],
    'auth-session backfill spans every workspace and org by design — request context would narrow it',
    async () => {
      const startedAt = Date.now();
      const now = new Date();
      const batches: AuthSessionBackfillBatch[] = [];
      const totals = emptyCounts();
      let cursor = options.cursor;
      let done = false;

      logger.info(`${TAG} started`, { ...options });

      for (let batchNumber = 1; batchNumber <= options.maxBatches; batchNumber += 1) {
        const { counts, nextCursor, exhausted } = await runBatch(cursor, options, now);
        cursor = nextCursor;

        for (const key of Object.keys(totals) as Array<keyof AuthSessionBackfillBatchCounts>) {
          totals[key] += counts[key];
        }
        batches.push({ batch: batchNumber, ...counts, nextCursor: cursor });
        logger.info(`${TAG} batch #${batchNumber}`, { ...counts, nextCursor: cursor, dryRun: options.dryRun });

        if (exhausted) {
          done = true;
          break;
        }
        if (batchNumber < options.maxBatches && options.delayMs > 0) {
          await sleep(options.delayMs);
        }
      }

      const durationMs = Date.now() - startedAt;
      logger.info(`${TAG} finished`, { ...totals, done, nextCursor: cursor, durationMs });
      return {
        batches,
        totals,
        done,
        nextCursor: done ? null : cursor,
        dryRun: options.dryRun,
        allOrgs: options.allOrgs,
        durationMs,
      };
    },
  );
}

export function getAuthSessionBackfillStatus(): Promise<AuthSessionBackfillStatus> {
  return asSystem(
    ['UserSession', 'SessionWorkspaceGrant', 'AuthSession'],
    'auth-session backfill status spans every workspace and org — request context would narrow it',
    async () => {
      const now = new Date();
      const [legacyActive, authSessions, grants] = await Promise.all([
        db.userSession.count({ where: liveLegacyWhere(now) }),
        db.authSession.count({ where: { status: SESSION_ACTIVE } }),
        db.sessionWorkspaceGrant.count({ where: { revokedAt: null } }),
      ]);

      // No relation between user_sessions and grants, so count mapped rows page by page
      // (ids only) rather than loading every grant's legacySessionId at once.
      let mapped = 0;
      let cursor: string | null = null;
      for (;;) {
        const page: Array<{ id: string }> = await db.userSession.findMany({
          where: { ...liveLegacyWhere(now), ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: STATUS_PAGE_SIZE,
        });
        if (page.length === 0) break;
        mapped += await db.sessionWorkspaceGrant.count({
          where: { legacySessionId: { in: page.map((r) => r.id) } },
        });
        cursor = page[page.length - 1].id;
        if (page.length < STATUS_PAGE_SIZE) break;
      }

      return { legacyActive, mapped, remaining: Math.max(0, legacyActive - mapped), authSessions, grants };
    },
  );
}
