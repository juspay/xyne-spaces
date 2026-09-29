import { Router } from 'express';
import { S2sAuthController } from '../controllers/authController';

const router = Router();
const authController = new S2sAuthController();

router.post('/auth/token', authController.token);

export default router;
