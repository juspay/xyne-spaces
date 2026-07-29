import { PrismaClient, Prisma } from '@prisma/client';
import { getContextOrNull } from './context';
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

  const row = await delegate.findUnique({ where, select: { workspaceId: true } });
  if (!row?.workspaceId) {
    // Nullable-deploy signal: the parent row exists but carries no workspaceId (e.g. an
    // un-backfilled row), or the row wasn't found at all. Surface it before throwing so it's
    // visible even if a caller swallows the error.
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
