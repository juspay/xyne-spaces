import express from 'express';
import { AuthV2Controller } from '../controllers/authV2Controller';
import { authV2Middleware } from '../middleware/authV2Middleware';

const router = express.Router();
const authV2Controller = new AuthV2Controller();

router.get('/login', authV2Controller.initiateLogin);

router.get('/callback', authV2Controller.handleCallback);

router.post('/exchange-electron', authV2Controller.exchangeElectronCode);

router.post('/exchange-mobile', authV2Controller.exchangeMobileCode);

router.get('/refresh-session', authV2Controller.refreshSession);

router.post('/logout', authV2Middleware.authenticate, authV2Controller.logout);

router.get('/me', authV2Middleware.authenticate, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user!.id,
      googleId: req.user!.googleId,
      email: req.user!.email,
      name: req.user!.name,
    },
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
    },
  });
});

export default router;
