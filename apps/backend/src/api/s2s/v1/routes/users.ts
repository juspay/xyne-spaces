import { Router } from 'express';
import { S2sUserController } from '../controllers/userController';

const router = Router();
const userController = new S2sUserController();

router.post('/user/create', userController.create);
router.post('/user/get', userController.list);
router.post('/user/update', userController.update);

export default router;
