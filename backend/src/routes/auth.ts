import express from 'express';
import { AuthV2Controller } from '../controllers/authV2Controller';
import { authV2Middleware } from '../middleware/authV2Middleware';
import { userManagementController } from '../controllers/userManagementController';

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
    }
  });
});

router.get('/validate', authV2Middleware.authenticate, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: req.user!.googleId,
      email: req.user!.email,
      name: req.user!.name,
    }
  });
});

router.get('/permissions', authV2Middleware.authenticate, userManagementController.getCurrentUserPermissions);

export default router;
