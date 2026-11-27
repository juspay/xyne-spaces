import { Router, type NextFunction, type Request, type Response } from 'express';
import { AccessType } from '@xyne/shared';
import { QueryController } from '@/controllers/queryController';
import { authorize } from '@/middleware/authorize';

const router = Router();

// The analytics screens need ANALYTICS access; the API asks for the same.
router.use(authorize('ANALYTICS', AccessType.READ));

// Guests see tickets by explicit grant; analytics over them is not offered.
router.use((req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return;
  }
  if (req.user?.role === 'GUEST') {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Analytics is not available to guests' } });
    return;
  }
  next();
});

router.get('/fields', QueryController.getFields);
router.post('/', QueryController.executeQuery);
router.post('/validate', QueryController.validateQuery);

export default router;
