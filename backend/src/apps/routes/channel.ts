import { Router } from 'express';
import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ChannelController } from '../controllers/channelController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const channelController = new ChannelController();

const OpenDmBodySchema = z.object({
  targetUserId: z.string().min(1).trim(),
  userId: z.string().min(1).trim(), // injected by authenticateApp (bot's userId)
  workspaceId: z.string().min(1).trim(),
});

router.post('/openDm', requirePermission('im:write'), async (req: Request, res: Response) => {
  const result = OpenDmBodySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation error', details: result.error.errors });
    return;
  }
  const { targetUserId, userId: botUserId, workspaceId } = result.data;
  try {
    const { unifiedDMService } = await import('@/bots/unified/services/unified-dm-service');
    const channel = await unifiedDMService.getOrCreateBotDM(targetUserId, botUserId, workspaceId);
    res.status(200).json({ channelId: channel.id });
  } catch (error) {
    logger.error('[openDm] Failed to open DM:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/info', requirePermission('channels:read'), validateChannelAccessForPost, channelController.getChannelByName);

router.get('/list', requirePermission('channels:read'), channelController.listChannels);

export default router;
