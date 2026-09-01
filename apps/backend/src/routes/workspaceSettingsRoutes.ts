import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { InviteExperience } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { authMiddleware } from '@/middleware/auth';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = DatabaseClient.getInstance();

router.patch(
  '/:workspaceId/invite-experience',
  authMiddleware.authenticate,
  authMiddleware.requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req.params;

    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Same cross-workspace guard used by invitationController.createInvitation:
    // requireAdminOrOwner alone doesn't scope which workspace the caller administers.
    if (req.user?.workspaceId !== workspaceId) {
      res.status(403).json({ error: 'Access denied - insufficient permissions' });
      return;
    }

    const { inviteExperience } = req.body as { inviteExperience?: unknown };
    if (
      typeof inviteExperience !== 'string' ||
      !Object.values(InviteExperience).includes(inviteExperience as InviteExperience)
    ) {
      res.status(400).json({
        error: `inviteExperience must be one of: ${Object.values(InviteExperience).join(', ')}`,
      });
      return;
    }

    try {
      const workspace = await prisma.workspace.update({
        where: { id: workspaceId },
        data: { inviteExperience },
        select: { id: true, inviteExperience: true },
      });

      res.status(200).json({
        workspaceId: workspace.id,
        inviteExperience: workspace.inviteExperience,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      logger.error('[WorkspaceSettingsRoutes] Failed to update inviteExperience:', error);
      res.status(500).json({ error: 'Failed to update workspace setting' });
    }
  },
);

export default router;
