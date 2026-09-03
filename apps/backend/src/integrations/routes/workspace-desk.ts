/**
 * Workspace shared mailbox (DL flow) — read APIs.
 *
 * - GET /status: current shared mailbox info or null
 *
 * Connect/disconnect of the shared mailbox itself live with the per-provider
 * OAuth routes (`/api/integrations/google/connect/workspace`,
 * `/api/integrations/microsoft/connect/workspace`).
 *
 * DL-desk creation goes through the regular `POST /api/channels` endpoint
 * with `type: 'EMAIL'` + `deskType: 'DL'` + `dlEmail`. The user types the DL
 * email manually; same-domain + uniqueness enforcement happens server-side at
 * channel-creation time.
 */

import express, { Request, Response } from 'express';
import { WorkspaceRole } from '@xyne/shared';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { ChannelEmailAliasService } from '@/services/channelEmailAliasService';
import { logger } from '@/utils/logger';
import { stopGmailWatchBeforeDeactivation } from '@/services/gmailWatchStopService';

const TAG = '[WorkspaceDesk]';
const router = express.Router();
router.use(express.json());
const channelEmailAliasService = new ChannelEmailAliasService();

interface MailboxStatus {
  configured: boolean;
  displayName: string | null;
  sourceType: string | null;
  isActive: boolean;
}

router.get(
  '/status',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId;
      const source = await db.externalSource.findFirst({
        where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: { in: ['google', 'microsoft'] } },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { displayName: true, sourceType: true, isActive: true },
      });
      const body: MailboxStatus = {
        configured: !!source,
        displayName: source?.displayName ?? null,
        sourceType: source?.sourceType ?? null,
        isActive: source?.isActive ?? false,
      };
      res.json(body);
    } catch (err) {
      logger.error(`${TAG} /status failed`, err);
      res.status(500).json({ error: 'Failed to load shared mailbox status' });
    }
  },
);

router.get(
  '/channel-email-status',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId;
      const body = await channelEmailAliasService.getWorkspaceChannelEmailMailboxStatus(workspaceId);
      res.json(body);
    } catch (err) {
      logger.error(`${TAG} /channel-email-status failed`, err);
      res.status(500).json({ error: 'Failed to load channel email mailbox status' });
    }
  },
);

/**
 * POST /api/integrations/workspace-desk/disconnect
 * Body: none
 * Soft-disconnects the workspace shared mailbox: clears credentials and
 * flips `isActive = false`.
 */
router.post(
  '/disconnect',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.user!.workspaceId;
    const role = req.user!.role as WorkspaceRole;

    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      res.status(403).json({ error: 'Only workspace owners and admins can disconnect the shared mailbox' });
      return;
    }

    try {
      const source = await db.externalSource.findFirst({
        where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: { in: ['google', 'microsoft'] } },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, sourceType: true, displayName: true, credentials: true },
      });
      if (!source) {
        res.status(404).json({ error: 'No shared mailbox configured for this workspace' });
        return;
      }

      // Must run BEFORE the OAuth revoke below, since stop() needs a valid token.
      await stopGmailWatchBeforeDeactivation(source, TAG);

      // Best-effort token revocation at the provider.
      try {
        if (source.sourceType === 'google') {
          const creds = JSON.parse(decrypt(source.credentials)) as {
            refreshToken?: string;
            accessToken?: string;
          };
          const tokenToRevoke = creds.refreshToken || creds.accessToken;
          if (tokenToRevoke) {
            const revokeRes = await fetch(
              `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`,
              { method: 'POST' },
            );
            if (!revokeRes.ok) {
              logger.warn(`${TAG} Google revoke returned ${revokeRes.status}`, { sourceId: source.id });
            }
          }
        }
        // Microsoft delegated tokens: no provider revoke endpoint.
      } catch (err) {
        logger.warn(`${TAG} Best-effort token revoke failed`, err);
      }

      await db.externalSource.update({
        where: { id: source.id },
        data: { isActive: false, credentials: '' },
      });

      logger.info(`${TAG} Disconnected workspace shared mailbox`, {
        workspaceId,
        sourceId: source.id,
        sourceType: source.sourceType,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error(`${TAG} /disconnect failed`, err);
      res.status(500).json({ error: 'Failed to disconnect shared mailbox' });
    }
  },
);

export default router;
