import { PrismaClient, Prisma } from '@prisma/client';
import { getContextOrNull, runAsSystem } from './context';
import { logger } from '@/utils/logger';

/**
 * Returns the workspaceId from the currently-open tenant context, if any.
 */
export function getCurrentWorkspaceId(): string | undefined {
  return getContextOrNull()?.workspaceId;
}

/**
 * Resolves a workspaceId by looking up a row in the given Prisma model.
 * Useful when only a foreign key is available (e.g., conversationId -> conversation.workspaceId).
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

  // Resolve under a system context so the tenant read-filter does NOT scope this
  // internal lookup to the ambient workspace. Without this, resolving a row that
  // legitimately belongs to a different workspace than the caller's current
  // context (e.g. a multi-workspace user row, or a cross-workspace parent FK)
  // would be filtered to null and this would spuriously throw below.
  const row = await runAsSystem(undefined, () =>
    delegate.findUnique({ where, select: { workspaceId: true } }),
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

/**
 * Returns the workspaceId from the primary entity if available, otherwise from a fallback.
 * The fallback can be another entity or a function that returns a workspaceId.
 */
export function resolveWorkspaceIdWithFallback(
  primary: { workspaceId?: string | null } | null | undefined,
  fallback: (() => string | null | undefined) | { workspaceId?: string | null } | null | undefined,
): string | undefined {
  if (primary?.workspaceId) {
    return primary.workspaceId;
  }
  if (typeof fallback === 'function') {
    return fallback() ?? undefined;
  }
  return fallback?.workspaceId ?? undefined;
}
