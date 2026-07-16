import { Router } from 'express';
import { YSweetController } from '../controllers/ysweetController';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const ysweetController = new YSweetController();

router.post('/auth', authMiddleware.authenticate, ysweetController.getClientToken.bind(ysweetController));
router.post('/duplicate', authMiddleware.authenticate, ysweetController.duplicateCanvas.bind(ysweetController));

export default router;
