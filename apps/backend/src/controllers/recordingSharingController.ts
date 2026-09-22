import type { Request, Response } from 'express';
import z from 'zod';
import { CallVisibility, EntityUserAccess } from '@xyne/shared';
import {
  recordingSharingService,
  RecordingSharingError,
  type RecordingSharingCommand,
} from '@/services/recordingSharingService';
import { logger } from '@/utils/logger';

const TargetSchema = z.object({
  type: z.enum(['user', 'user_group', 'channel']),
  id: z.string().min(1),
});

const RecordingSharingCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    targets: z.array(TargetSchema).min(1).max(100),
    access: z
      .enum([EntityUserAccess.VIEW, EntityUserAccess.EDIT, EntityUserAccess.ADMIN])
      .optional(),
    // Optional rich-text share message.
    messageContent: z.string().trim().min(1).max(10000).optional(),
  }),
  z.object({
    action: z.literal('revoke'),
    targets: z.array(TargetSchema).min(1).max(100),
  }),
  z.object({
    action: z.literal('link_ticket'),
    ticketId: z.string().min(1),
  }),
  z.object({ action: z.literal('unlink_ticket') }),
  z.object({
    action: z.literal('set_visibility'),
    visibility: z.enum([CallVisibility.PUBLIC, CallVisibility.PRIVATE]),
  }),
]);

export class RecordingSharingController {
  manage = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    const callId = req.params.callId;
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    if (!callId) {
      res.status(400).json({ success: false, message: 'Recording ID is required' });
      return;
    }

    const parsed = RecordingSharingCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid sharing request',
      });
      return;
    }

    try {
      logger.info('[RecordingSharingController] Recording sharing action received', {
        callId,
        userId: user.id,
        workspaceId: user.workspaceId,
        action: parsed.data.action,
        targetCount: parsed.data.action === 'grant' || parsed.data.action === 'revoke'
          ? parsed.data.targets.length
          : undefined,
      });

      const result = await recordingSharingService.execute(callId, {
        userId: user.id,
        workspaceId: user.workspaceId,
      }, parsed.data as RecordingSharingCommand);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof RecordingSharingError) {
        res.status(error.status).json({ success: false, message: error.message });
        return;
      }
      logger.error('[RecordingSharingController] Failed to manage recording sharing', {
        callId,
        action: parsed.data.action,
        error,
      });
      res.status(500).json({ success: false, message: 'Failed to update recording sharing' });
    }
  };
}

export const recordingSharingController = new RecordingSharingController();
