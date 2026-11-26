import { ContractError } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';

/**
 * Xyne Apps call and ticket reads on the typed framework: no req/res, same answers as the
 * controller methods they replace (AppCallController.getCall / listSummaryTemplates /
 * getSummaryTemplate, TicketController.listBoards / listBoardStages / listBySender).
 * Unexpected errors go to the app's error handler, as the call controller's next(error) did.
 */

export function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Unauthorized' });
  return user;
}