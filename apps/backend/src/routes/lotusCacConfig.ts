import { Router } from 'express';
import { LotusCacConfigController } from '@/controllers/lotusCacConfigController';

const router = Router();
const controller = new LotusCacConfigController();

// Static path before /:key so "all" is not treated as a config key
router.get('/', controller.getAllConfigs);
router.get('/:key', controller.getConfig);

export default router;
