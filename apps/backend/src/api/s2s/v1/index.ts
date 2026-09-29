import { Router } from 'express';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';

export function createV1Router(): Router {
  const router = Router();
  router.use(userRoutes);
  router.use(authRoutes);
  return router;
}
