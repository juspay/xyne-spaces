import { Router, type NextFunction, type Request, type Response } from 'express';
import { AccessType } from '@xyne/shared';
import { QueryController } from '@/controllers/queryController';
import { authorize } from '@/middleware/authorize';
import { queryOwner, withinRate } from '@/services/queryService/queryGuards';

const router = Router();

// The analytics screens need ANALYTICS access; the API asks for the same.
router.use(authorize('ANALYTICS', AccessType.READ));

// Guests see tickets by explicit grant; analytics over them is not offered. Every later step
// (including the running-query limit) knows whose request this is.
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
  queryOwner.run({ userId, workspaceId }, next);
});

router.get('/fields', QueryController.getFields);
router.post(
  '/',
  (_req: Request, res: Response, next: NextFunction) => {
    const owner = queryOwner.getStore()!;
    withinRate(owner)
      .then(ok => {
        if (ok) return next();
        res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many queries; try again in a minute' } });
      })
      .catch(next);
  },
  QueryController.executeQuery,
);
router.post('/validate', QueryController.validateQuery);

export default router;
