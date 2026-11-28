import { api } from '@xyne/shared';
import { ConversationLabelLifecycleError, conversationLabelLifecycleService } from '@/automations/services/conversation-label-lifecycle.service';
import { ContractError, controller } from '@/framework/api';
import { getLabelUnreadCount, getLabelUnreadCounts } from '@/services/conversationLabelUnreadService';
import type { AuthenticatedUser } from '@/types/express';
import { assertChannelMembershipOf } from '@/utils/channelMembership';
import { logger } from '@/utils/logger';

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
export const labelUnreadCounts = controller(api.conversationLabels.unreadCounts, async (input) => {
  try {
    const auth = labelAuth(input.user);
    await requireChannelMember(input.user, input.query.channelId);
    return labelsAnswer({ counts: await getLabelUnreadCounts(auth, input.query.channelId) });
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to get label unread counts', 'unread-counts');
  }
});

/** POST /conversation-labels/unread-counts: one label's count, with filters. */
export const labelUnreadCount = controller(api.conversationLabels.unreadCount, async (input) => {
  try {
    const auth = labelAuth(input.user);
    const { channelId, labelId, filters } = input.body;
    await requireChannelMember(input.user, channelId);
    return labelsAnswer({ labelId, unreadCount: await getLabelUnreadCount(auth, channelId, labelId, filters) });
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to get label unread count', 'filtered unread-count');
  }
});

/** GET /conversation-labels/:labelId/delete-impact */
export const labelDeleteImpact = controller(api.conversationLabels.deleteImpact, async (input) => {
  try {
    return labelsAnswer(await conversationLabelLifecycleService.getDeleteImpact(labelAuth(input.user), input.params.labelId));
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to calculate label delete impact', 'delete-impact');
  }
});

/** DELETE /conversation-labels/:labelId */
export const labelDelete = controller(api.conversationLabels.delete, async (input) => {
  try {
    return labelsAnswer(await conversationLabelLifecycleService.deleteLabel(labelAuth(input.user), input.params.labelId));
  } catch (error) {
    throw lifecycleFailure(error, 'Failed to delete label', 'delete');
  }
});