import express from 'express';
import { AuthV2Controller } from '../controllers/authV2Controller';
import { MicrosoftAuthController } from '../controllers/microsoftAuthController';
import { EmailAuthController } from '../controllers/emailAuthController';
import { authV2Middleware } from '../middleware/authV2Middleware';
import { providerIdentity } from '@/auth/providerIdentity';

const router = express.Router();
const authV2Controller = new AuthV2Controller();
const microsoftAuthController = new MicrosoftAuthController();
const emailAuthController = new EmailAuthController();

router.get('/providers', (_req, res) => {
  return res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    email: true,
  });
});

router.get('/login', authV2Controller.initiateLogin);

router.get('/callback', authV2Controller.handleCallback);

router.get('/microsoft/login', microsoftAuthController.initiateLogin);

router.get('/microsoft/callback', microsoftAuthController.handleCallback);

router.post('/microsoft/exchange-mobile', microsoftAuthController.exchangeMobile);

router.post('/exchange-electron', authV2Controller.exchangeElectronCode);

router.post('/exchange-mobile', authV2Controller.exchangeMobileCode);

router.get('/refresh-session', authV2Controller.refreshSession);

router.post('/email/login', emailAuthController.login);

router.post('/email/register', emailAuthController.register);

router.post('/email/verify', emailAuthController.verifyEmail);

router.post('/email/resend-code', emailAuthController.resendVerificationCode);

router.post('/email/forgot-password', emailAuthController.requestResetCode);

router.post('/email/reset-password', emailAuthController.resetPassword);

router.post('/email/change-password', authV2Middleware.authenticate, emailAuthController.changePassword);

router.post('/logout', authV2Middleware.authenticate, authV2Controller.logout);

router.get('/me', authV2Middleware.authenticate, async (req, res) => {
  const identity = await providerIdentity(req);
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: identity.googleId,
      email: req.user!.email,
      name: req.user!.name,
      workspaceId: req.user!.workspaceId,
      role: req.user!.role,
      orgRole: req.user!.orgRole,
      memberId: req.user!.memberId,
      authProvider: identity.authProvider,
    },
  });
});

router.get('/validate', authV2Middleware.authenticate, async (req, res) => {
  const identity = await providerIdentity(req);
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: identity.googleId,
      email: req.user!.email,
      name: req.user!.name,
      workspaceId: req.user!.workspaceId,
      role: req.user!.role,
      orgRole: req.user!.orgRole,
      memberId: req.user!.memberId,
      authProvider: identity.authProvider,
    },
  });
});

export default router;
