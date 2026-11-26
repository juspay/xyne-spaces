import { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { QueryController } from '@/controllers/queryController';
import { authorize } from '@/middleware/authorize';

const router = Router();

// Running a ticket analytics query needs the ANALYTICS permission (read or above), not just a
// signed-in user. Members hold it by default; guests and community members do not.
router.use(authorize('ANALYTICS', AccessType.READ));

router.get('/fields', QueryController.getFields);
router.post('/', QueryController.executeQuery);
router.post('/validate', QueryController.validateQuery);

export default router;
