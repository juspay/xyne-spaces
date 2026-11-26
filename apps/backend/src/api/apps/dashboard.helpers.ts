import { AppCommandRepository } from '@/database/repositories/appCommandRepository';
import { ContractError } from '@/framework/api';
import { logger } from '@/utils/logger';

/**
 * The Xyne Apps dashboard API on the typed framework (apps/routes/apps.ts): no req/res, same
 * answers as the controller methods they replace (AppController, PermissionController,
 * CommandController, AppResourceController, FetchConfigController and the management half of
 * IncomingWebhookController). A ContractError is an answer; anything else is logged and
 * answered as the controller did.
 */

export const appCommandRepository = new AppCommandRepository();

/** An error the controller answered as 500 `{ error: 'Internal server error' }` (or `body`), logged first. */
export function internal(error: unknown, logMessage: string, body: { error: string } = { error: 'Internal server error' }): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, body);
}

// ─── Permissions ────────────────────────────────────────────────────────────

/** An error message to its answer: "Unknown permissions…" is a 400, anything else a 500 (the message is returned). */
export function permissionsFailure(error: unknown): ContractError {
  if (error instanceof ContractError) return error;
  const msg = error instanceof Error ? error.message : 'Internal server error';
  return new ContractError(msg.startsWith('Unknown permissions') ? 400 : 500, { error: msg });
}