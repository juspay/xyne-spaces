import { ContractError } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * Dashboard settings and admin APIs on the typed framework (activity aliases, client events,
 * custom emojis, a channel's tag-generation config, a file's metadata): no req/res, same
 * answers as the controllers they replace, except that a request that breaks its contract is
 * now the framework's 400 (`code: VALIDATION_ERROR`) rather than each controller's own text.
 */

export function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Authentication required' });
  return user;
}

export function internal(error: unknown, logMessage: string, body: { error: string } = { error: 'Internal server error' }): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, body);
}