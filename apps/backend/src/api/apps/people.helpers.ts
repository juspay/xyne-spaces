import { ContractError } from '@/framework/api';
import { logger } from '@/utils/logger';

/**
 * Xyne Apps users, user groups and guests on the typed framework: no req/res, same answers as
 * the controllers they replace (UserController, UserGroupController, GuestController).
 */

/** "… not found" → 404, anything else → 500, as the user and user-group controllers answered. */
export function notFoundOr500(error: unknown, logMessage: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  if (error instanceof Error && error.message.includes('not found')) {
    return new ContractError(404, { error: error.message, code: 'NOT_FOUND' });
  }
  return new ContractError(500, { error: 'Internal server error' });
}