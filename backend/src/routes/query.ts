import { Router } from 'express';
import { QueryController } from '@/controllers/queryController';

const router = Router();

router.get('/fields', QueryController.getFields);
router.post('/', QueryController.executeQuery);
router.post('/validate', QueryController.validateQuery);

export default router;