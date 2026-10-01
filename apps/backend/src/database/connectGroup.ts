import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { getConnectAclMode } from '@/services/otel';

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
 *     entityType: 'channel', entityId: channel.id,
 *     hostWorkspaceId: channel.workspaceId, connectId,
 *   });
 */

export type ConnectEntityType = 'channel' | 'canvas';

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
 * Resolve the connectIds shared INTO `workspaceId` — the connectIds of ACTIVE connect_groups where
 * this workspace is the INVITED side — and record the connect_acl_mode metric.
 *
 * We deliberately do NOT include groups this workspace HOSTS: a host's own rows already carry its
 * `workspaceId`, so `connectReachWhere` covers them with the cheap, indexed `workspaceId = ctx.ws`
 * branch. Fetching only the invited set keeps the `connectId IN (...)` list tiny (empty until
 * sharing exists) instead of "one id per channel+canvas in the workspace". Prisma can't subquery
 * connect_group by the non-unique connectId, so callers match `connectId IN (ids)` themselves.
 *
 * `ok = false` means the connect_group lookup threw: the caller MUST fall back to its plain
 * workspace predicate (the exact pre-Connect behaviour) rather than filter on an empty id list,
 * and the metric records outcome=error_fallback so a real regression is visible, not silent.
 * `table`/`op` are metric labels only.
 */
export async function resolveReachableConnectIds(
  client: Prisma.TransactionClient,
  workspaceId: string,
  table = 'unknown',
  op: ConnectAclOp = 'read',
): Promise<{ ids: string[]; ok: boolean }> {
  try {
    const groups = await client.connectGroup.findMany({
      where: {
        status: 'ACTIVE',
        invitedWorkspaceId: workspaceId,
      },
      select: { connectId: true },
    });
    getConnectAclMode().add(1, {
      entity: 'canvas',
      table,
      layer: 'prisma',
      op,
      mode: 'connect_group',
      outcome: 'ok',
    });
    return { ids: groups.map((g) => g.connectId), ok: true };
  } catch {
    getConnectAclMode().add(1, {
      entity: 'canvas',
      table,
      layer: 'prisma',
      op,
      mode: 'workspace',
      outcome: 'error_fallback',
    });
    return { ids: [], ok: false };
  }
}

/**
 * Slack Connect — Prisma ACL reach fragment for tables that HAVE a `workspaceId` column. A row is
 * reachable when it belongs to THIS workspace (its own entities — the bulk; covered by the indexed
 * `workspaceId` column, and this also catches null-connectId rows) OR its connectId was shared INTO
 * this workspace (the small invited set). AND this with the table's membership clause. On lookup
 * failure, degrades to the plain `workspaceId` predicate (see resolveReachableConnectIds).
 *
 * Equivalent to the old `connectId IN (host+invited) OR (connectId null AND workspaceId)`, but the
 * huge "host" half is handled by the indexed `workspaceId = ctx.ws` instead of a giant IN-list —
 * only the tiny shared-into-me set stays a `connectId IN (...)` (empty until sharing exists).
 */
export async function connectReachWhere(
  client: Prisma.TransactionClient,
  workspaceId: string,
  table = 'unknown',
  op: ConnectAclOp = 'read',
): Promise<
  | { OR: [{ workspaceId: string }, { connectId: { in: string[] } }] }
  | { workspaceId: string }
> {
  const { ids, ok } = await resolveReachableConnectIds(client, workspaceId, table, op);
  // No invited connectIds (the norm today) or a lookup failure → plain workspace scope.
  if (!ok || ids.length === 0) return { workspaceId };
  return { OR: [{ workspaceId }, { connectId: { in: ids } }] };
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
