import express from 'express';
import { AuthV2Controller } from '../controllers/authV2Controller';
import { authV2Middleware } from '../middleware/authV2Middleware';
import { userManagementController } from '../controllers/userManagementController';
import { channelService } from '../services/channelService';
import { logger } from '../utils/logger'; 

const router = express.Router();
const authV2Controller = new AuthV2Controller();

router.get('/login', authV2Controller.initiateLogin);

router.get('/exchange', authV2Controller.handleCallback);

router.post('/exchange-electron', authV2Controller.dispatchElectronExchange);

router.get('/refresh-session', authV2Controller.refreshSession);

router.post('/logout', authV2Middleware.authenticate, authV2Controller.logout);

router.get('/logout', authV2Middleware.authenticate, authV2Controller.logout);

router.get('/me', authV2Middleware.authenticate, (req, res) => {
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
    }
  });
});

router.get('/validate', authV2Middleware.authenticate, async (req, res) => {
  // [DEBUG] Log if there's a pending invitation cookie — if so, user is already logged in
  // but has an unprocessed invitation. This is the root cause of landing on wrong workspace.
  const pendingInvitation = req.cookies?.pending_invitation_id;
  logger.info(`[DEBUG] [/validate] user=${req.user!.id} email=${req.user!.email} workspaceId=${(req.user as any).workspaceId ?? 'unknown'} pending_invitation_id=${pendingInvitation ?? 'NONE'}`);
  if (pendingInvitation) {
    logger.warn(`[DEBUG] [/validate] ⚠️ User already has a session but pending_invitation_id cookie exists (${pendingInvitation}). OAuth callback will be skipped — invitation will NOT be auto-accepted via callback flow.`);
  }
  const selfDmChannelId = await channelService.getSelfDmId(req.user!.id);
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
    },
    selfDmChannelId,
  });
});

router.get('/permissions', authV2Middleware.authenticate, userManagementController.getCurrentUserPermissions);

router.post('/login-workspace', authV2Controller.loginWorkspace);
router.post('/create-org', authV2Controller.createOrg);

router.get('/workspaces', authV2Middleware.authenticate, authV2Controller.getWorkspaces);
router.post('/switch-workspace', authV2Middleware.authenticate, authV2Controller.switchWorkspace);
router.post('/create-workspace', authV2Middleware.authenticate, authV2Controller.createWorkspaceAuth);

export default router;
