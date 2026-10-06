/**
 * Pure grouping for the auth-session backfill. Legacy `workflow.user_sessions` rows that share a
 * refreshToken belong to one device/session: pre-PR rows have unique tokens (one session, one
 * grant each); rows written after this PR for legacy-only orgs share `refreshToken = deviceKey`
 * (one session, N grants).
 */
import { createHash } from 'crypto';
import { isUuid } from './sessionTokens';

export interface LegacyBackfillRow {
  id: string;
  userId: string;
  workspaceId: string;
  refreshToken: string;
  refreshTokenExpiry: Date;
  createdAt: Date;
  lastActivity: Date;
  deviceInfo: string | null;
  ipAddress: string | null;
}

export interface BackfillGroup {
  refreshToken: string;
  /** `refreshToken` when it is already a uuid, else sha256(refreshToken). */
  deviceKey: string;
  /** Rows ordered by createdAt asc (id asc on ties). */
  rows: LegacyBackfillRow[];
  /** Earliest row = the login row. */
  legacySessionId: string;
  authenticatedAt: Date;
  absoluteExpiry: Date;
  lastSeenAt: Date;
  /** Distinct workspace ids across the rows (one grant each). */
  workspaceIds: string[];
}

export function deviceKeyFromRefreshToken(refreshToken: string): string {
  return isUuid(refreshToken) ? refreshToken.toLowerCase() : createHash('sha256').update(refreshToken).digest('hex');
}

function byCreatedThenId(a: LegacyBackfillRow, b: LegacyBackfillRow): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function groupLegacyRows(rows: LegacyBackfillRow[]): BackfillGroup[] {
  const byToken = new Map<string, LegacyBackfillRow[]>();
  for (const row of rows) {
    const list = byToken.get(row.refreshToken);
    if (list) list.push(row);
    else byToken.set(row.refreshToken, [row]);
  }
  const groups: BackfillGroup[] = [];
  for (const [refreshToken, list] of byToken) {
    const sorted = [...list].sort(byCreatedThenId);
    // One grant per workspace: keep the earliest row of each workspace, later duplicates are
    // superseded (they still get mapped by the service via the group's deviceKey).
    const workspaceIds = [...new Set(sorted.map((r) => r.workspaceId))];
    groups.push({
      refreshToken,
      deviceKey: deviceKeyFromRefreshToken(refreshToken),
      rows: sorted,
      legacySessionId: sorted[0].id,
      authenticatedAt: sorted[0].createdAt,
      absoluteExpiry: new Date(Math.max(...sorted.map((r) => r.refreshTokenExpiry.getTime()))),
      lastSeenAt: new Date(Math.max(...sorted.map((r) => r.lastActivity.getTime()))),
      workspaceIds,
    });
  }
  // Deterministic order: by the login row's createdAt.
  return groups.sort((a, b) => a.authenticatedAt.getTime() - b.authenticatedAt.getTime() || (a.legacySessionId < b.legacySessionId ? -1 : 1));
}

/** The first row per workspace — the one whose id becomes `grant.legacySessionId`. */
export function primaryRowsPerWorkspace(group: BackfillGroup): LegacyBackfillRow[] {
  const seen = new Set<string>();
  const out: LegacyBackfillRow[] = [];
  for (const r of group.rows) {
    if (seen.has(r.workspaceId)) continue;
    seen.add(r.workspaceId);
    out.push(r);
  }
  return out;
}
