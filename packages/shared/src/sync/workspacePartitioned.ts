/**
 * SINGLE SOURCE OF TRUTH for workspace-partitioned sync queries — the ACL-free, workspace-scoped
 * base that BOTH the backend (materialization) and the client (local IVM) build. Keeping it here
 * (imported by both) means the client can never drift from what the server materializes.
 *
 * A workspace-partitioned query keys ONE instance per workspace (`partition = workspaceId`), forced
 * from the authenticated socket on the backend and injected from `ctx.workspaceId` on the client —
 * never a client-supplied query arg (`queries.ts` is untouched; the base reads `args.workspaceId`,
 * which the sync layer populates).
 *
 * Two server-side delivery shapes, distinguished ONLY by `routeColumn` (the client treats both
 * identically — host base, render received rows):
 *   - no `routeColumn`  → BROADCAST: the ACL collapses to `workspaceId = ws`, so every member sees
 *     every row; the gate path room-broadcasts one snapshot to all subscribers (e.g. getUsersV2).
 *   - a `routeColumn`   → ROW-LEVEL: the ACL is `owner == me`; the workspace instance holds every
 *     user's rows and the fan-out routes each row to `row[routeColumn]` (e.g. userDrafts → userId).
 */
import type { AnyQuery } from '@rocicorp/zero';
import { zql } from '../zero/queries.js';

const wsOf = (args: unknown): string => {
  const ws = (args as { workspaceId?: unknown } | undefined)?.workspaceId;
  if (typeof ws !== 'string' || ws === '') {
    // workspaceId is forced from the socket (backend) / injected from ctx (client), so a missing
    // value here is internal misuse — fail loud rather than materialize a garbage instance.
    throw new Error('workspace-partitioned base requires workspaceId (from socket/ctx, not a query arg)');
  }
  return ws;
};

export interface WorkspacePartitionedSpec {
  /** ACL-free, workspace-scoped base. Reads `args.workspaceId` (socket-forced / ctx-injected). */
  base: (args: unknown) => AnyQuery;
  /** Present ⇒ ROW-LEVEL (route each row to `row[routeColumn]`). Absent ⇒ BROADCAST (gate room-cast). */
  routeColumn?: string;
  /**
   * The NATIVE query is a `.one()` (singular). The workspace base drops `.one()` (it holds every
   * user's row), so the client would materialize an ARRAY where the consumer expects one object.
   * Until the client applies the singular projection, such a query is served by the BACKEND registry
   * but withheld from client routing (`SHARED_QUERY_NAMES` filters it) → it stays on native Zero.
   */
  singular?: boolean;
  /** Row-level onboarding note recorded at registration (the related-table ownership audit). */
  relatedAudit?: string;
}

/** Client-servable = the client's array result matches the native shape (i.e. NOT a `.one()` query). */
export function isClientServable(spec: WorkspacePartitionedSpec): boolean {
  return !spec.singular;
}

export const WORKSPACE_PARTITIONED_REGISTRY: ReadonlyMap<string, WorkspacePartitionedSpec> = new Map<
  string,
  WorkspacePartitionedSpec
>([
  // ── BROADCAST (no routeColumn): ACL = workspaceId == ws, every member sees every row ──────────────
  // users: UsersACL (non-guest) = workspaceId == ws (guests refused by the role gate → native Zero).
  ['getUsersV2', { base: (args) => zql.users.where('workspaceId', wsOf(args)) }],
  // user_groups: UserGroupsACL (non-guest) = workspaceId == ws.
  ['getAllUserGroups', { base: (args) => zql.user_groups.where('workspaceId', wsOf(args)).orderBy('createdAt', 'desc') }],

  // ── ROW-LEVEL (routeColumn): ACL = owner == me; workspace instance, routed per owner ──────────────
  // bookmarks: ACL `userId == me`; native adds `isDeleted == false` (subscriber-independent).
  ['userBookmarks', {
    routeColumn: 'userId',
    base: (args) => zql.bookmarks.where('workspaceId', wsOf(args)).where('isDeleted', false).orderBy('createdAt', 'desc'),
  }],
  // user_preferences: ACL `userId == me`. Native `.one()` is a per-subscriber projection dropped here —
  // the workspace instance holds every user's row; fan-out routes each user their single row.
  ['getCurrentUserPreference', {
    routeColumn: 'userId',
    singular: true, // native `.one()` → withheld from client routing until singular projection lands
    base: (args) => zql.user_preferences.where('workspaceId', wsOf(args)),
  }],
  // draft_messages: owner pin normalized into the ACL (draft-messages-acl.ts) so it is ACL-eligible.
  ['userDrafts', {
    routeColumn: 'userId',
    base: (args) => zql.draft_messages.where('workspaceId', wsOf(args)).related('attachments'),
    relatedAudit:
      'attachments → message_attachments joined by draft.id = entityId (1:1-owned: each attachment ' +
      "belongs to one draft ⇒ one owner). Native serves it via message_attachments' own createdBy ACL arm.",
  }],
]);

export function isWorkspacePartitioned(name: string | undefined | null): boolean {
  return !!name && WORKSPACE_PARTITIONED_REGISTRY.has(name);
}

/** Route column (row-level) for a workspace-partitioned query, or undefined if broadcast / unknown. */
export function workspaceRouteColumn(name: string): string | undefined {
  return WORKSPACE_PARTITIONED_REGISTRY.get(name)?.routeColumn;
}

/** The ACL-free workspace-scoped base for a workspace-partitioned query, or undefined if not one. */
export function workspacePartitionedBase(name: string, args: unknown): AnyQuery | undefined {
  return WORKSPACE_PARTITIONED_REGISTRY.get(name)?.base(args);
}
