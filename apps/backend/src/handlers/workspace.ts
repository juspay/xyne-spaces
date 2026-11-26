import type { IncomingHttpHeaders } from 'node:http';
import type { z } from 'zod';
import type { conversationLabelsUnreadCount } from '@xyne/shared';
import {
  ConversationLabelLifecycleError,
  conversationLabelLifecycleService,
} from '@/automations/services/conversation-label-lifecycle.service';
import { ContractError } from '@/framework/api';
import { CacConfigService } from '@/services/cacConfigService';
import { getLabelUnreadCount, getLabelUnreadCounts } from '@/services/conversationLabelUnreadService';
import { linkExistingSubTicket, SubTicketLinkError, unlinkSubTicket, type SubTicketLinkActor } from '@/services/subTicketLinkService';
import type { AuthenticatedUser } from '@/types/express';
import { assertChannelMembershipOf } from '@/utils/channelMembership';
import { logger } from '@/utils/logger';

/**
 * CAC config, sub-ticket links and conversation labels on the typed framework: no req/res, same
 * answers as the controllers and route handlers they replace.
 */

// ─── CAC config ─────────────────────────────────────────────────────────────

/** GET /cac-config/:key: the Superposition context is the caller's email, workspace and (playground) environment. */
export async function cacConfig(input: { params: { key: string }; user: AuthenticatedUser | undefined; headers: IncomingHttpHeaders }) {
  const email = input.user?.email?.trim();
  const workspaceId = input.user?.workspaceId;
  const routeEnv = input.headers['x-route-env'];
  const isPlayground = (Array.isArray(routeEnv) ? routeEnv[0] : routeEnv)?.trim().toLowerCase() === 'playground';
  const context = {
    ...(email ? { email } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(isPlayground ? { environment: 'playground' } : {}),
  };
  return { key: input.params.key, config: await CacConfigService.fetch(input.params.key, context) };
}

// ─── Sub-tickets ────────────────────────────────────────────────────────────

function subTicketActor(user: AuthenticatedUser | undefined): SubTicketLinkActor {
  const userId = user?.id;
  const workspaceId = user?.workspaceId;
  if (!userId || !workspaceId) throw new ContractError(401, { error: 'Unauthorized' });
  // role here is untrusted (the API-key path sets the key's role); the service re-resolves the
  // workspace role from users.role before any guest decision.
  return { userId, workspaceId, role: user?.role ?? '' };
}

function subTicketFailure(error: unknown, fallback: string): ContractError {
  if (error instanceof ContractError) return error;
  if (error instanceof SubTicketLinkError) return new ContractError(error.status, { error: error.message });
  logger.error(`[SubTicketController] ${fallback}:`, error);
  return new ContractError(500, { error: fallback });
}

/** POST /sub-tickets/link: answers 201. */
export async function linkSubTicket(input: {
  body: { ticketId: string; mappedTicketId: string; subTicketTitle?: unknown };
  user: AuthenticatedUser | undefined;
}) {
  const actor = subTicketActor(input.user);
  const { ticketId, mappedTicketId, subTicketTitle } = input.body;
  try {
    return await linkExistingSubTicket({
      actor,
      ticketId: ticketId.trim(),
      mappedTicketId: mappedTicketId.trim(),
      subTicketTitle: typeof subTicketTitle === 'string' && subTicketTitle.trim() ? subTicketTitle.trim() : 'Subticket',
    });
  } catch (error) {
    throw subTicketFailure(error, 'Failed to link sub-ticket');
  }
}

/** POST /sub-tickets/unlink: answers 204. */
export async function unlinkSubTicketHandler(input: { body: { mappingId: string }; user: AuthenticatedUser | undefined }) {
  const actor = subTicketActor(input.user);
  try {
    await unlinkSubTicket({ actor, mappingId: input.body.mappingId.trim() });
    return null;
  } catch (error) {
    throw subTicketFailure(error, 'Failed to unlink sub-ticket');
  }
}

// ─── Conversation labels ────────────────────────────────────────────────────

const labelFailure = (message: string, status = 500, extra: Record<string, unknown> = {}) =>
  new ContractError(status, { success: false, error: message, ...extra });

function labelAuth(user: AuthenticatedUser | undefined): { userId: string; workspaceId: string } {
  if (!user?.id || !user.workspaceId) throw labelFailure('Unauthorized', 401);
  return { userId: user.id, workspaceId: user.workspaceId };
}

async function requireChannelMember(user: AuthenticatedUser | undefined, channelId: string): Promise<void> {
  const access = await assertChannelMembershipOf(user, channelId);
  if (!access.ok) throw labelFailure(access.error, access.status);
}

function lifecycleFailure(error: unknown, fallback: string, logLabel: string): ContractError {
  if (error instanceof ContractError) return error;
  if (error instanceof ConversationLabelLifecycleError) {
    if (error.code === 'not-found') return labelFailure(error.message, 404);
    if (error.code === 'forbidden') return labelFailure(error.message, 403);
    return labelFailure(error.message, 409, { code: 'label_in_use', data: error.impact });
  }
  logger.error(`[conversation-labels] ${logLabel} failed:`, error);
  return labelFailure(fallback);
}

const labelsAnswer = <T>(data: T) => ({ success: true as const, data, timestamp: new Date().toISOString() });

/** GET /conversation-labels/unread-counts?channelId= */
export async function labelUnreadCounts(input: { query: { channelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const auth = labelAuth(input.user);
    await requireChannelMember(input.user, input.query.channelId);
    return labelsAnswer({ counts: await getLabelUnreadCounts(auth, input.query.channelId) });
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to get label unread counts', 'unread-counts');
  }
}

/** POST /conversation-labels/unread-counts: one label's count, with filters. */
export async function labelUnreadCount(input: { body: z.infer<(typeof conversationLabelsUnreadCount)['body']>; user: AuthenticatedUser | undefined }) {
  try {
    const auth = labelAuth(input.user);
    const { channelId, labelId, filters } = input.body;
    await requireChannelMember(input.user, channelId);
    return labelsAnswer({ labelId, unreadCount: await getLabelUnreadCount(auth, channelId, labelId, filters) });
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to get label unread count', 'filtered unread-count');
  }
}

/** GET /conversation-labels/:labelId/delete-impact */
export async function labelDeleteImpact(input: { params: { labelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    return labelsAnswer(await conversationLabelLifecycleService.getDeleteImpact(labelAuth(input.user), input.params.labelId));
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to calculate label delete impact', 'delete-impact');
  }
}

/** DELETE /conversation-labels/:labelId */
export async function labelDelete(input: { params: { labelId: string }; user: AuthenticatedUser | undefined }) {
  try {
    return labelsAnswer(await conversationLabelLifecycleService.deleteLabel(labelAuth(input.user), input.params.labelId));
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to delete label', 'delete');
  }
}
