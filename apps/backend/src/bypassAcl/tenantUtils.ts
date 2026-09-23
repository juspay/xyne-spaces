import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { asSystem, type TableName } from './base';

/**
 * Relocated from sdlc/sdlcNavTarget.ts. Keyed on the entity id alone, so every load runs as
 * system: under a caller's own scope the same id answers differently per user, and one of those
 * answers would be served to everyone. A null is dropped rather than cached — it usually means a
 * row that has not been written yet, and a write-time stamp is permanent.
 */
export function memoizeAsSystem<A, T>(
  tables: TableName[],
  reason: string,
  keyOf: (arg: A) => string,
  load: (arg: A) => Promise<T>,
): (arg: A) => Promise<T> {
  const TTL_MS = 60_000;
  const MAX_ENTRIES = 5_000;
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return arg => {
    const key = keyOf(arg);
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
    if (entries.size >= MAX_ENTRIES) entries.clear();
    const value = asSystem(tables, reason, () => load(arg)).then(
      resolved => {
        if (resolved == null) entries.delete(key);
        return resolved;
      },
      (error: unknown) => {
        entries.delete(key);
        throw error;
      },
    );
    entries.set(key, { at: Date.now(), value });
    return value;
  };
}

/**
 * Relocated from database/tenant/workspace-utils.ts. Generic, model-agnostic — called from 16+
 * repositories/workers/services whenever only a foreign key is available (e.g. conversationId ->
 * conversation.workspaceId). Runs under system context so the tenant read-filter does NOT scope
 * this internal lookup to the ambient workspace: resolving a row that legitimately belongs to a
 * different workspace than the caller's current context (a multi-workspace user row, a
 * cross-workspace parent FK) would otherwise be filtered to null and this would spuriously throw.
 */
export async function resolveWorkspaceIdFromModel(
  prisma: PrismaClient | Prisma.TransactionClient,
  model: string,
  where: Record<string, unknown>,
): Promise<string> {
  const delegate = (prisma as unknown as Record<string, { findUnique: (args: { where: Record<string, unknown>; select: { workspaceId: true } }) => Promise<{ workspaceId: string } | null> }>)[
    model
  ];
  if (!delegate) {
    throw new Error(`Unknown Prisma model: ${String(model)}`);
  }

  const row = await asSystem(
    [model as TableName],
    'foreign-key-only resolution: row may legitimately belong to a workspace other than the ambient one',
    () => delegate.findUnique({ where, select: { workspaceId: true } }),
  );
  if (!row?.workspaceId) {
    // Signal an un-backfilled/missing parent before throwing, so it's visible even if a
    // caller swallows the error.
    logger.warn('resolveWorkspaceIdFromModel: could not resolve workspaceId', {
      model: String(model),
      where,
      rowFound: !!row,
    });
    throw new Error(`Could not resolve workspaceId from ${String(model)}`);
  }
  logger.debug('resolveWorkspaceIdFromModel: resolved workspaceId', {
    model: String(model),
    where,
    workspaceId: row.workspaceId,
  });
  return row.workspaceId;
}
