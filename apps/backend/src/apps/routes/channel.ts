import { Router } from 'express';
import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { ChannelController } from '../controllers/channelController';
import { validateChannelAccessForPost } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const channelController = new ChannelController();

// workspaceId is intentionally NOT accepted from the body: the tenant is
// derived from the verified app token (req.user.workspaceId) so an app
// installed in workspace A cannot open a DM in workspace B.
const OpenDmBodySchema = z.object({
  targetUserId: z.string().min(1).trim(),
});

router.post('/openDm', requirePermission('im:write'), async (req: Request, res: Response) => {
  const result = OpenDmBodySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Validation error', details: result.error.errors });
    return;
  }
  const { targetUserId } = result.data;
  const botUserId = req.user!.id; // set by authenticateApp (bot's userId)
  const workspaceId = req.user!.workspaceId; // tenant from the verified token, never the body
  if (!workspaceId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    // Tenant isolation: the target user must belong to the same workspace as the
    // authenticated app/bot. Return 404 (not 403) on mismatch so cross-tenant
    // user IDs cannot be enumerated.
    const targetUser = await repositories.users.findById(targetUserId);
    if (!targetUser || targetUser.workspaceId !== workspaceId) {
      logger.warn(
        `[openDm] Rejected cross-workspace/unknown target user ${targetUserId} for workspace ${workspaceId}`,
      );
      res.status(404).json({ error: 'Target user not found' });
      return;
    }
    const { unifiedDMService } = await import('@/bots/unified/services/unified-dm-service');
    const channel = await unifiedDMService.getOrCreateBotDM(targetUserId, botUserId, workspaceId);
    res.status(200).json({ channelId: channel.id });
  } catch (error) {
    logger.error('[openDm] Failed to open DM:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/info', requirePermission('channels:read'), validateChannelAccessForPost, channelController.getChannelByName);

router.post('/deskChannelConfig', requirePermission('desk:read'), validateChannelAccessForPost, channelController.getDeskConfig);

router.get('/list', requirePermission('channels:read'), channelController.listChannels);

export default router;
