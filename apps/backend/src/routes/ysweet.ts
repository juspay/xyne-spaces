import { Router } from 'express';
import { YSweetController } from '../controllers/ysweetController';

const router = Router();
const ysweetController = new YSweetController();

router.post('/auth', ysweetController.getClientToken.bind(ysweetController));

export default router;

export const ysweetValidateRouter = Router();

ysweetValidateRouter.post('/', ysweetController.validateAccess.bind(ysweetController));
