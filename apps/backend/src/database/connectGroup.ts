import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { getConnectAclMode } from '@/services/otel';
import { isConnectCanvasReachEnabled } from '@/services/connectFlags';
import { ConnectEntityType } from '@xyne/shared';

// Re-export so existing `@/database/connectGroup` importers can pull the enum from here too.
export { ConnectEntityType };

/**
 * Slack Connect — Phase 1 helper.
 *
 * Every channel/canvas gets a `connectId` (its connect_group handle) and exactly one
 * PRIVATE `connect_group` row at creation time. "Private" = a single workspace:
 * invitedEntityId / invitedWorkspaceId stay NULL, status is 'ACTIVE'. Sharing (multiple
 * rows per connectId) is a later phase.
 *
 * Usage at a create-site — mint the id, stamp it on the entity, insert the group row in
 * the SAME transaction/client:
 *
 *   const connectId = newConnectId();
 *   const channel = await tx.channel.create({ data: { ...input, connectId } });
 *   await createConnectGroupForEntity(tx, {
 *     entityType: ConnectEntityType.CHANNEL, entityId: channel.id,
 *     hostWorkspaceId: channel.workspaceId, connectId,
 *   });
 */

/**
 * Client surface both the top-level `db` and an interactive `$transaction` tx satisfy.
 * `Prisma.TransactionClient` is the interactive-tx client (all model delegates, minus
 * `$transaction`/`$connect`/…); the full `PrismaClient` is assignable to it, so this one
 * type accepts both callers.
 */
type ConnectGroupWriter = Prisma.TransactionClient;

/** Generate a fresh connectId (opaque handle, unique per entity in Phase 1). */
export function newConnectId(): string {
  return randomUUID();
}

/**
 * Insert the single private connect_group row for a freshly-created channel/canvas.
 * Call with the same client/tx that created the entity so the two are atomic.
 */
export async function createConnectGroupForEntity(
  client: ConnectGroupWriter,
  params: {
    entityType: ConnectEntityType;
    entityId: string;
    hostWorkspaceId: string;
    connectId: string;
  },
): Promise<void> {
  const now = new Date();
  await client.connectGroup.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      hostWorkspaceId: params.hostWorkspaceId,
      invitedEntityId: null,
      invitedWorkspaceId: null,
      connectId: params.connectId,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Resolve the connectId of an existing canvas (for children created on a canvas that already
 * exists — comments, versions, participants added later). Returns null when not yet backfilled.
 */
export async function resolveCanvasConnectId(
  client: Prisma.TransactionClient,
  canvasId: string,
): Promise<string | null> {
  const row = await client.canvas.findUnique({
    where: { id: canvasId },
    select: { connectId: true },
  });
  return row?.connectId ?? null;
}

/** Slack Connect — which ACL surface the reach is being evaluated for (metric label). */
export type ConnectAclOp = 'read' | 'write';

/**
 * Why a reach call resolved the way it did — the `reason` label on `connect_acl_mode`, so every
 * evaluation is accounted for (e.g. "10 calls: 7 connect_group, 3 workspace — 2 flag_off, 1 missing").
 *  - connect_group    : resolved via connect_group (parent id-set, or child single-connectId gate)
 *  - flag_off         : connect reach flag disabled → legacy workspace scope (no connect_group query)
 *  - unknown_table    : table not in the canvas reach set → legacy workspace scope
 *  - connect_id_missing: child read with no connectId to gate on (un-backfilled canvas / unscoped list)
 *  - error_fallback   : a connect_group lookup threw → legacy workspace scope (a real regression)
 */
export type ConnectAclReason =
  | 'connect_group'
  | 'flag_off'
  | 'unknown_table'
  | 'connect_id_missing'
  | 'error_fallback';

/** Emit one connect_acl_mode sample. Every connectReachWhere return path calls this exactly once. */
function recordConnectAcl(
  table: string,
  op: ConnectAclOp,
  mode: 'connect_group' | 'workspace',
  reason: ConnectAclReason,
): void {
  getConnectAclMode().add(1, {
    entity: ConnectEntityType.CANVAS,
    table,
    layer: 'prisma',
    op,
    mode,
    outcome: reason === 'error_fallback' ? 'error_fallback' : 'ok',
    reason,
  });
}

/**
 * Slack Connect — the workspaces that can reach a given `connectId`: the host plus every ACTIVE
 * invited workspace. This is the SMALL per-entity set (one entity's sharing), not the per-workspace
 * set, so a single-entity (child) read — which is already scoped to one `connectId` — can authorize
 * by "is the caller's workspace in this set?" instead of materialising every reachable connectId.
 */
export async function resolveConnectWorkspaces(
  client: Prisma.TransactionClient,
  connectId: string,
): Promise<string[]> {
  const groups = await client.connectGroup.findMany({
    where: { status: 'ACTIVE', connectId },
    select: { hostWorkspaceId: true, invitedWorkspaceId: true },
  });
  const workspaces = new Set<string>();
  for (const g of groups) {
    workspaces.add(g.hostWorkspaceId);
    if (g.invitedWorkspaceId) workspaces.add(g.invitedWorkspaceId);
  }
  return [...workspaces];
}

/**
 * Slack Connect — single-entity authorization gate: may `workspaceId` reach `connectId`?
 * True when the caller's workspace is the host or an ACTIVE invited workspace of that connect group.
 * Use this for connectId-scoped child reads (participants, comments, versions of ONE canvas): the
 * query isolates rows by `connectId`, and this gate decides whether the caller is allowed to see them.
 */
export async function canWorkspaceReachConnect(
  client: Prisma.TransactionClient,
  workspaceId: string,
  connectId: string,
): Promise<boolean> {
  const workspaces = await resolveConnectWorkspaces(client, connectId);
  return workspaces.includes(workspaceId);
}

// Slack Connect — canvas tables whose Prisma reach resolves via connect_group. The PARENT canvas is
// matched on its own `id` (== connect_group.entityId); CHILD tables on their `connectId`.
const CANVAS_PARENT_TABLES = new Set<string>(['canvases']);
const CANVAS_CHILD_TABLES = new Set<string>([
  'canvas_participants',
  'canvas_versions',
  'canvas_comment_threads',
  'canvas_comments',
  'canvas_user_status',
]);


/** connectId IS NULL (un-backfilled) → legacy workspace scope; matches Zero's `legacy` branch. (Parent only.) */
type ConnectNullFallback = { AND: [{ connectId: null }, { workspaceId: string }] };
/**
 * Only the shapes assignable to EVERY canvas table's WhereInput (all carry `workspaceId`):
 * `{ workspaceId }` (legacy/fallback) and `{}` (gate ALLOW). The child DENY
 * (`{ canvasConnectId: { in: [] } }` — child column) and the PARENT id-set are table-specific and
 * cast past this type at their return sites, since the canvas parent and its children no longer
 * share a connect column name (parent `connectId`, children `canvasConnectId`).
 */
export type ConnectReachWhere = { workspaceId: string } | Record<string, never>;

/**
 * What the query is scoped to, so a child read can authorize by its single connect handle (not a list).
 * `connectId` here is the VALUE (the canvas's connect handle); for canvas children it comes from the
 * `canvasConnectId` column, for the parent from `connectId` — the ACL reads whichever its table has.
 */
export interface ConnectReachScope {
  connectId?: string;
  canvasId?: string;
}

/**
 * Slack Connect — Prisma ACL reach fragment for the canvas entity + its child tables.
 *
 * The two halves are gated differently on purpose:
 *
 *  - CHILD (participants/versions/… of ONE opened canvas) — ALWAYS connect_group, no flag. The query
 *    already isolates rows by a single `connectId`/`canvasId`, so we authorize with the small per-entity
 *    GATE: resolve that one connectId's host+invited workspaces and check the caller is among them. It's
 *    cheap and self-correcting — a row with no connectId yet (un-backfilled canvas) falls back to
 *    `{ workspaceId }`, so it works incrementally during backfill without a switch. Gate pass → add no
 *    restriction (the query already pins the entity); gate fail → match nothing.
 *
 *  - PARENT (canvases list) — FLAG-GATED (`connect_query_enabled_canvas`, default OFF). Listing "all
 *    canvases I can reach" via `id IN (reachable entityIds)` is only complete once EVERY canvas has a
 *    connect_group row (the backfill), and it materialises the reachable id-set; so until the flag is
 *    flipped (post-backfill) the parent stays on the legacy `{ workspaceId }` list. Flag ON →
 *    `id IN entityIds` OR the `connectId IS NULL` legacy fallback.
 *
 * On a connect_group lookup failure either half degrades to plain `{ workspaceId }`.
 */
export async function connectReachWhere(
  client: Prisma.TransactionClient,
  workspaceId: string,
  table = 'unknown',
  op: ConnectAclOp = 'read',
  scope?: ConnectReachScope,
): Promise<ConnectReachWhere> {
  const isParent = CANVAS_PARENT_TABLES.has(table);
  const isChild = CANVAS_CHILD_TABLES.has(table);
  // Unknown table → stay safe on plain workspace scope.
  if (!isParent && !isChild) {
    recordConnectAcl(table, op, 'workspace', 'unknown_table');
    return { workspaceId };
  }

  // CHILD: always-on per-connectId gate (no flag — self-correcting via the missing-connectId fallback).
  if (isChild) {
    // Only a single string id is a usable scope; a relational filter (e.g. `{ in: [...] }`, a
    // multi-canvas list read) is not one entity to gate on — ignore it (→ workspace) rather than
    // feeding an object into resolveCanvasConnectId / findUnique.
    const scopeConnectId = typeof scope?.connectId === 'string' ? scope.connectId : undefined;
    const scopeCanvasId = typeof scope?.canvasId === 'string' ? scope.canvasId : undefined;
    try {
      let connectId = scopeConnectId;
      if (!connectId && scopeCanvasId) {
        connectId = (await resolveCanvasConnectId(client, scopeCanvasId)) ?? undefined;
      }
      // No connectId to gate on (un-backfilled canvas, or an unscoped/multi-entity list) → legacy scope.
      if (!connectId) {
        recordConnectAcl(table, op, 'workspace', 'connect_id_missing');
        return { workspaceId };
      }
      const allowed = await canWorkspaceReachConnect(client, workspaceId, connectId);
      recordConnectAcl(table, op, 'connect_group', 'connect_group');
      // Pass → no extra restriction (the query's connect column already isolates). Fail → match nothing
      // via the child's connect column (renamed to canvasConnectId).
      return allowed ? {} : ({ canvasConnectId: { in: [] } } as unknown as ConnectReachWhere);
    } catch {
      recordConnectAcl(table, op, 'workspace', 'error_fallback');
      return { workspaceId };
    }
  }

  // PARENT (canvases list): flag-gated until the backfill is complete.
  if (!isConnectCanvasReachEnabled()) {
    recordConnectAcl(table, op, 'workspace', 'flag_off');
    return { workspaceId };
  }
  recordConnectAcl(table, op, 'connect_group', 'connect_group');
  const nullFallback: ConnectNullFallback = { AND: [{ connectId: null }, { workspaceId }] };
  // Correlated EXISTS, NOT a materialised id-set. A canvas is reachable when its OWN connect_group
  // (connect_group.entityId == canvas.id) has an ACTIVE row with this workspace as host or invited —
  // Postgres evaluates it per candidate row through the `connectGroups` relation, so there is no
  // `id IN (…)` list and no 32,767 bind-variable ceiling on large workspaces. A not-yet-backfilled
  // canvas (connectId NULL, no group row) still shows via the `connectId IS NULL → workspaceId`
  // fallback until the backfill runs. Cast past the child-safe type (parent-only shape).
  return {
    OR: [
      {
        connectGroups: {
          some: {
            status: 'ACTIVE',
            OR: [{ hostWorkspaceId: workspaceId }, { invitedWorkspaceId: workspaceId }],
          },
        },
      },
      nullFallback,
    ],
  } as unknown as ConnectReachWhere;
}

/** Resolve the connectId of an existing channel (for channel-scoped folders). */
export async function resolveChannelConnectId(
  client: Prisma.TransactionClient,
  channelId: string,
): Promise<string | null> {
  const row = await client.channel.findUnique({
    where: { id: channelId },
    select: { connectId: true },
  });
  return row?.connectId ?? null;
}
