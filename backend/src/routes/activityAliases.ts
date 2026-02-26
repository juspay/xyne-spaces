import { Router } from 'express';
import { AccessType } from '@prisma/client';
import { authorize } from '@/middleware/authorize';
import {
  getAllAliases,
  createAlias,
  updateAlias,
  deleteAlias,
} from '@/controllers/activityAliasController';

const router = Router();

// Middleware to check for USER_ACTIVITY admin access
const userActivityAdminAuth = authorize('USER_ACTIVITY', AccessType.ADMIN);

// GET /api/activity-aliases - List all aliases (requires authentication)
router.get('/', getAllAliases);

// POST /api/activity-aliases - Create new alias (requires USER_ACTIVITY admin permission)
router.post('/', userActivityAdminAuth, createAlias);

// PUT /api/activity-aliases/:id - Update existing alias (requires USER_ACTIVITY admin permission)
router.put('/:id', userActivityAdminAuth, updateAlias);

// DELETE /api/activity-aliases/:id - Delete alias (requires USER_ACTIVITY admin permission)
router.delete('/:id', userActivityAdminAuth, deleteAlias);

export default router;
