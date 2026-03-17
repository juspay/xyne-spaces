import { Router } from 'express';
import { CacConfigController } from '@/controllers/cacConfigController';

const router = Router();
const cacConfigController = new CacConfigController();

router.get('/:key', cacConfigController.getConfig);

export default router;
