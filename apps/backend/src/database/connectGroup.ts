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
 * Resolve the connectIds `workspaceId` can reach — the connectIds of ACTIVE connect_groups it
 * hosts or is invited to — and record the connect_acl_mode metric. Prisma can't subquery
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
        OR: [{ hostWorkspaceId: workspaceId }, { invitedWorkspaceId: workspaceId }],
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
 * Slack Connect — Prisma ACL reach fragment for tables that HAVE a `workspaceId` column. A row
 * is reachable when its connectId is in `workspaceId`'s reach; rows with no connectId fall back
 * to `workspaceId`. AND this with the table's membership clause. On lookup failure, degrades to
 * the plain `workspaceId` predicate (see resolveReachableConnectIds).
 */
export async function connectReachWhere(
  client: Prisma.TransactionClient,
  workspaceId: string,
  table = 'unknown',
  op: ConnectAclOp = 'read',
): Promise<
  | { OR: [{ connectId: { in: string[] } }, { connectId: null; workspaceId: string }] }
  | { workspaceId: string }
> {
  const { ids, ok } = await resolveReachableConnectIds(client, workspaceId, table, op);
  return ok
    ? { OR: [{ connectId: { in: ids } }, { connectId: null, workspaceId }] }
    : { workspaceId };
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
