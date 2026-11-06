import express from 'express';
import { AuthV2Controller } from '../controllers/authV2Controller';
import { authMiddleware } from '../middleware/auth';
import { userManagementController } from '../controllers/userManagementController';
import { channelService } from '../services/channelService';
import { canCreateWorkspace } from '../middleware/workspaceAuth';
import { logger } from '../utils/logger';
import { DatabaseClient } from '../database/client';

const prisma = DatabaseClient.getInstance();
const router = express.Router();
const authV2Controller = new AuthV2Controller();

router.get('/login', authV2Controller.initiateLogin);

router.get('/exchange', authV2Controller.handleCallback);

router.post('/exchange-electron', authV2Controller.dispatchElectronExchange);

router.get('/refresh-session', authV2Controller.refreshSession);

router.post('/logout', authMiddleware.authenticate, authV2Controller.logout);

router.get('/logout', authMiddleware.authenticate, authV2Controller.logout);

router.get('/me', authMiddleware.authenticate, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: req.user!.googleId,
      email: req.user!.email,
      name: req.user!.name,
      workspaceId: req.user!.workspaceId,
      role: req.user!.role,
      orgRole: req.user!.orgRole,
      memberId: req.user!.memberId,
      authProvider: req.user!.authProvider,
    }
  });
});

router.get('/validate', authMiddleware.authenticate, async (req, res) => {
  // [DEBUG] Log if there's a pending invitation cookie — if so, user is already logged in
  // but has an unprocessed invitation. This is the root cause of landing on wrong workspace.
  const pendingInvitation = req.cookies?.pending_invitation_id;
  logger.info(`[DEBUG] [/validate] user=${req.user!.id} email=${req.user!.email} workspaceId=${(req.user as any).workspaceId ?? 'unknown'} pending_invitation_id=${pendingInvitation ?? 'NONE'}`);
  if (pendingInvitation) {
    logger.warn(`[DEBUG] [/validate] ⚠️ User already has a session but pending_invitation_id cookie exists (${pendingInvitation}). OAuth callback will be skipped — invitation will NOT be auto-accepted via callback flow.`);
  }
  const selfDmChannelId = await channelService.getSelfDmId(req.user!.id);
  const workspace = await prisma.workspace.findUnique({
    where: { id: req.user!.workspaceId },
    select: { landingChannelId: true },
  });
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: req.user!.googleId,
      email: req.user!.email,
      name: req.user!.name,
      workspaceId: req.user!.workspaceId,
      role: req.user!.role,
      orgRole: req.user!.orgRole,
      memberId: req.user!.memberId,
      authProvider: req.user!.authProvider,
    },
    selfDmChannelId,
    landingChannelId: workspace?.landingChannelId ?? null,
    // The dashboard refreshes shortly before this so cookie-only loads (images, video, PDF) never 401.
    accessTokenExpiresAt: req.user!.tokenExpiresAt ?? null,
  });
});

router.get('/permissions', authMiddleware.authenticate, userManagementController.getCurrentUserPermissions);
router.get('/roles', authMiddleware.authenticate, userManagementController.getCurrentUserRoles);

router.post('/login-workspace', authV2Controller.loginWorkspace);
router.post('/create-org', authV2Controller.createOrg);

router.get('/workspaces', authMiddleware.authenticate, authV2Controller.getWorkspaces);
router.post('/switch-workspace', authMiddleware.authenticate, authV2Controller.switchWorkspace);
// router.post('/create-workspace-pending', authV2Controller.createWorkspaceWithPendingAuth);
router.post('/create-workspace', authMiddleware.authenticate, canCreateWorkspace, authV2Controller.createWorkspaceAuth);

export default router;
