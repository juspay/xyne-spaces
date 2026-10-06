import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { TicketPriority } from '@xyne/shared';
import { logger } from '@/utils/logger';
import {
  conversationLabelLifecycleService,
  ConversationLabelLifecycleError,
} from '@/automations/services/conversation-label-lifecycle.service';
import {
  getLabelUnreadCount,
  getLabelUnreadCounts,
} from '@/services/conversationLabelUnreadService';
import { assertChannelMembership } from '@/utils/channelMembership';

const router = Router();

function getAuthContext(req: Request): { userId: string; workspaceId: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function handleLifecycleError(res: Response, err: ConversationLabelLifecycleError): void {
  if (err.code === 'not-found') {
    res.status(404).json({ success: false, error: err.message });
    return;
  }
  if (err.code === 'forbidden') {
    res.status(403).json({ success: false, error: err.message });
    return;
  }
  res.status(409).json({
    success: false,
    error: err.message,
    code: 'label_in_use',
    data: err.impact,
  });
}

router.get('/unread-counts', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const channelId = req.query.channelId;
    if (typeof channelId !== 'string' || channelId.length === 0) {
      res.status(400).json({ success: false, error: 'channelId query param is required' });
      return;
    }

    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) {
      res.status(access.status).json({ success: false, error: access.error });
      return;
    }

    const counts = await getLabelUnreadCounts(auth, channelId);
    res.json({ success: true, data: { counts }, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[conversation-labels] unread-counts failed:', err);
    res.status(500).json({ success: false, error: 'Failed to get label unread counts' });
  }
});

const unreadCountsFiltersSchema = z
  .object({
    assignedTo: z.array(z.string()).optional(),
    createdBy: z.array(z.string()).optional(),
    priority: z.array(z.nativeEnum(TicketPriority)).optional(),
    stageName: z.array(z.string()).optional(),
    aiCategory: z.array(z.string()).optional(),
    conversationIds: z.array(z.string()).optional(),
    hasAiDraft: z.boolean().optional(),
    hasSubTickets: z.boolean().optional(),
    userGroups: z.array(z.string()).optional(),
    lastEmailAtStart: z.number().optional(),
    lastEmailAtEnd: z.number().optional(),
    createdAtStart: z.number().optional(),
    createdAtEnd: z.number().optional(),
    dynamicFieldFilters: z
      .array(
        z.object({
          fieldId: z.string(),
          values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
        }),
      )
      .optional(),
  });

const unreadCountsBodySchema = z.object({
  channelId: z.string(),
  labelId: z.string(),
  filters: unreadCountsFiltersSchema.optional(),
});

router.post('/unread-counts', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const parsed = unreadCountsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    const { channelId, labelId, filters } = parsed.data;

    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) {
      res.status(access.status).json({ success: false, error: access.error });
      return;
    }

    const unreadCount = await getLabelUnreadCount(auth, channelId, labelId, filters);
    res.json({ success: true, data: { labelId, unreadCount }, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[conversation-labels] filtered unread-count failed:', err);
    res.status(500).json({ success: false, error: 'Failed to get label unread count' });
  }
});

router.get('/:labelId/delete-impact', async (req: Request<{ labelId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const impact = await conversationLabelLifecycleService.getDeleteImpact(
      auth,
      req.params.labelId,
    );
    res.json({ success: true, data: impact, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ConversationLabelLifecycleError) {
      handleLifecycleError(res, err);
      return;
    }
    logger.error('[conversation-labels] delete-impact failed:', err);
    res.status(500).json({ success: false, error: 'Failed to calculate label delete impact' });
  }
});

router.delete('/:labelId', async (req: Request<{ labelId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const result = await conversationLabelLifecycleService.deleteLabel(auth, req.params.labelId);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ConversationLabelLifecycleError) {
      handleLifecycleError(res, err);
      return;
    }
    logger.error('[conversation-labels] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete label' });
  }
});

export default router;
