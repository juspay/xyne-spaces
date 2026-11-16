import { Prisma } from '@prisma/client';

/**
 * DB-level guard for DEFAULT channel names. Partial unique index added by migration
 * 20261022120000_channels_unique_active_default_name (Prisma can't express partial indexes).
 */
export const CHANNEL_NAME_UNIQUE_INDEX = 'channels_workspaceId_name_active_default_key';

/** Thrown when a channel name is already taken in the workspace. Callers map it to HTTP 409. */
export class DuplicateChannelNameError extends Error {
  readonly code = 'DUPLICATE_CHANNEL_NAME';
  constructor(name: string) {
    super(`Channel with name "${name}" already exists.`);
    this.name = 'DuplicateChannelNameError';
  }
}

/**
 * True when `error` is the unique violation from CHANNEL_NAME_UNIQUE_INDEX, i.e. a concurrent request
 * created a channel with the same name between our lookup and our insert.
 */
export function isChannelNameUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  // Postgres reports the index name for index-backed uniques; some Prisma versions report the
  // column list instead. Accept either, but only for the channel-name guard.
  if (typeof target === 'string') return target === CHANNEL_NAME_UNIQUE_INDEX;
  if (Array.isArray(target)) return target.includes('name') && target.includes('workspaceId');
  return false;
}
