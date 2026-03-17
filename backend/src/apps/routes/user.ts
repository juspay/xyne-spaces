import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { validateChannelAccessForGet } from '../middelware/channelValidation';

const router = Router();
const userController = new UserController();

router.get('/info', validateChannelAccessForGet, userController.getUserInfo);

export default router;
