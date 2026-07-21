import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import {
  getAllHeaderOverrides,
  setHeaderOverrides,
  removeHeaderOverrides,
  getMyHeaderOverrides,
} from '@/controllers/userHeaderOverridesController';

const headerOverridesAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

const router = Router();

router.get('/me', authMiddleware.authenticate, getMyHeaderOverrides);

router.get('/', authMiddleware.authenticate, headerOverridesAdminAuth, getAllHeaderOverrides);
router.post('/', authMiddleware.authenticate, headerOverridesAdminAuth, setHeaderOverrides);
router.delete('/', authMiddleware.authenticate, headerOverridesAdminAuth, removeHeaderOverrides);

export default router;
