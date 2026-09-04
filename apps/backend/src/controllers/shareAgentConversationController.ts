import { Request, Response } from 'express';
import '../types/express';
import { logger } from '@/utils/logger';
import {
  getAgentConversationPreview,
  getPreShareStatus,
  shareAgentConversationToChannel,
  ShareAgentConversationError,
  type ShareErrorCode,
} from '@/services/shareAgentConversationService';

const ERROR_STATUS: Record<ShareErrorCode, number> = {
  CHANNEL_NOT_FOUND: 404,
  NOT_A_CHANNEL_MEMBER: 403,
  INVALID_TARGET_CHANNEL: 422,
  CHANNEL_ARCHIVED: 409,
  RESHARE_CONFIRMATION_REQUIRED: 409,
  EMPTY_TRANSCRIPT: 422,
  TRANSCRIPT_TOO_LARGE: 413,
  NO_NEW_MESSAGES: 409,
  ADD_AGENT_FORBIDDEN: 403,
  AGENT_NOT_INSTALLED: 422,
  SHARING_DISABLED: 403,
};

function handleError(res: Response, error: unknown, context: string): void {
  if (error instanceof ShareAgentConversationError) {
    res.status(ERROR_STATUS[error.code]).json({ error: error.message, code: error.code });
    return;
  }
  logger.error(`[shareAgentConversation] ${context} failed`, { error });
  res.status(500).json({ error: 'Failed to share agent conversation' });
}

export class ShareAgentConversationController {
  getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId;
      const { channelId } = req.params;
      const agentSlug = String(req.query.agentSlug ?? '');
      const sourceConversationId = String(req.query.sourceConversationId ?? '');
      const activePathTipMessageId = req.query.activePathTipMessageId
        ? String(req.query.activePathTipMessageId)
        : null;

      if (!channelId || !agentSlug || !sourceConversationId) {
        res
          .status(400)
          .json({ error: 'channelId, agentSlug and sourceConversationId are required' });
        return;
      }
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const status = await getPreShareStatus({
        agentSlug,
        sourceConversationId,
        targetChannelId: channelId,
        activePathTipMessageId,
        userId,
        workspaceId,
      });
      res.status(200).json(status);
    } catch (error) {
      handleError(res, error, 'getStatus');
    }
  };

  getPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId;
      const agentSlug = String(req.query.agentSlug ?? '');
      const sourceConversationId = String(req.query.sourceConversationId ?? '');

      if (!agentSlug || !sourceConversationId) {
        res.status(400).json({ error: 'agentSlug and sourceConversationId are required' });
        return;
      }
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const preview = await getAgentConversationPreview({
        agentSlug,
        sourceConversationId,
        userId,
        workspaceId,
      });
      res.status(200).json(preview);
    } catch (error) {
      handleError(res, error, 'getPreview');
    }
  };

  share = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId;
      const { channelId } = req.params;
      const {
        agentSlug,
        sourceConversationId,
        addAgentConfirmed,
        reShareConfirmed,
        shareOperationId,
        note,
      } = req.body ?? {};

      if (!channelId || !agentSlug || !sourceConversationId) {
        res
          .status(400)
          .json({ error: 'channelId, agentSlug and sourceConversationId are required' });
        return;
      }
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await shareAgentConversationToChannel({
        agentSlug: String(agentSlug),
        sourceConversationId: String(sourceConversationId),
        targetChannelId: channelId,
        userId,
        workspaceId,
        addAgentConfirmed: Boolean(addAgentConfirmed),
        reShareConfirmed: Boolean(reShareConfirmed),
        shareOperationId: shareOperationId ? String(shareOperationId) : undefined,
        ...(typeof note === 'string' ? { note } : {}),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, 'share');
    }
  };
}
