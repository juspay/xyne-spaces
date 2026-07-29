import { AccessType } from '@prisma/client';
import { authorize } from './authorize';

/**
 * Middleware to check if user can create workspaces.
 * Requires WRITE access (ADMIN also permitted via hierarchy) to the WORKSPACE resource.
 */
export const canCreateWorkspace = authorize('WORKSPACE', AccessType.WRITE);
