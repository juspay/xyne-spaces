import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import {
  getAllHeaderOverrides,
  postClientEvent,
  removeHeaderOverrides,
  getMyHeaderOverrides,
} from '@/controllers/userHeaderOverridesController';

const clientEventsAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

const router = Router();

router.get('/me', authMiddleware.authenticate, getMyHeaderOverrides);

router.get('/', authMiddleware.authenticate, clientEventsAdminAuth, getAllHeaderOverrides);
router.post('/', authMiddleware.authenticate, clientEventsAdminAuth, postClientEvent);
router.delete('/', authMiddleware.authenticate, clientEventsAdminAuth, removeHeaderOverrides);

export default router;
