/**
 * Read-only directory lookups for claw-auth (service routes in claw/routes.ts),
 * replacing claw-auth's direct read access to the Spaces database.
 *
 * Minimal fields only. Mention lookups return active HUMAN users (never bots,
 * apps or agents) and at most 2 rows, so a caller can tell "one match" from
 * "ambiguous".
 */

import { UserType } from '@xyne/shared';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';

export interface DirectoryUser {
  id: string;
  email: string;
  name: string;
  spacesOrgMemberId: string | null;
  workspaceId: string | null;
  spacesOrgId: string | null;
  status: string;
}

export type UserHit = { id: string; name: string };

const LIMIT = 2;

export async function directoryUser(id: string): Promise<DirectoryUser | null> {
  if (!id) return null;
  const u = await runAsSystem(() =>
    db.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, orgMemberId: true, workspaceId: true, status: true },
    })
  );
  if (!u) return null;
  const ws = u.workspaceId
    ? await runAsSystem(() => db.workspace.findUnique({ where: { id: u.workspaceId! }, select: { orgId: true } }))
    : null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    spacesOrgMemberId: u.orgMemberId ?? null,
    workspaceId: u.workspaceId ?? null,
    spacesOrgId: ws?.orgId ?? null,
    status: String(u.status),
  };
}

const scope = (workspaceId?: string) => (workspaceId ? { workspaceId } : {});

/** Active humans whose name or display name is exactly `name` (case-insensitive). */
export async function usersByName(name: string, workspaceId?: string): Promise<UserHit[]> {
  const n = name.trim();
  if (!n) return [];
  return runAsSystem(() =>
    db.user.findMany({
      where: {
        userType: UserType.USER,
        status: 'ACTIVE',
        ...scope(workspaceId),
        OR: [{ name: { equals: n, mode: 'insensitive' } }, { displayName: { equals: n, mode: 'insensitive' } }],
      },
      select: { id: true, name: true },
      take: LIMIT,
    })
  );
}

/** Active users with this email (emails repeat across workspaces; scope when known). */
export async function usersByEmail(email: string, workspaceId?: string): Promise<UserHit[]> {
  const e = email.trim();
  if (!e) return [];
  return runAsSystem(() =>
    db.user.findMany({
      where: { status: 'ACTIVE', ...scope(workspaceId), email: { equals: e, mode: 'insensitive' } },
      select: { id: true, name: true },
      take: LIMIT,
    })
  );
}

/** Active users whose email local part is `handle` (`@first.last` → first.last@…). */
export async function usersByHandle(handle: string, workspaceId?: string): Promise<UserHit[]> {
  const h = handle.trim();
  if (!h || h.includes('@')) return [];
  return runAsSystem(() =>
    db.user.findMany({
      where: { status: 'ACTIVE', ...scope(workspaceId), email: { startsWith: `${h}@`, mode: 'insensitive' } },
      select: { id: true, name: true },
      take: LIMIT,
    })
  );
}

/** Active user group by mention alias, in the workspace when given. */
export async function groupsByAlias(alias: string, workspaceId?: string): Promise<Array<{ id: string; name: string; alias: string | null }>> {
  const a = alias.trim();
  if (!a) return [];
  return runAsSystem(() =>
    db.userGroup.findMany({
      where: { isActive: true, ...scope(workspaceId), alias: { equals: a, mode: 'insensitive' } },
      select: { id: true, name: true, alias: true },
      take: LIMIT,
    })
  );
}
