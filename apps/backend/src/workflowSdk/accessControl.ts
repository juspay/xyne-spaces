// Access to Workflow Studio IS the WORKFLOW-STUDIO ACL resource, granted from
// User Management like any other gated screen. The level decides everything:
// READ browses, WRITE creates/edits/runs, ADMIN adds approvals + credentials.
//
// The generic aclMiddleware.checkAccess is not used because it derives the
// resource name from the first path segment, which here is "workflow-studio"
// but which it would then also have to grade — and it cannot report the level
// back, which the authorizer needs. One lookup below answers both questions.

import type { Request, Response, NextFunction } from 'express';
import { AccessType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/** ACL resource gating the v2 engine. Distinct from legacy WORKFLOWS. */
const WORKFLOW_STUDIO_RESOURCE = 'WORKFLOW-STUDIO';

const ADMIN_FLAG = 'workflowStudioAdmin';

// Same grading as aclService.getRequiredAccessLevel.
const requiredAccessFor = (method: string): AccessType => {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return AccessType.READ;
    default:
      return AccessType.WRITE;
  }
};

const workflowStudioResourceId = async (): Promise<string | null> => {
  const resource = await DatabaseClient.getInstance().resource.findUnique({
    where: { name: WORKFLOW_STUDIO_RESOURCE },
    select: { id: true },
  });
  return resource?.id ?? null;
};

/** Resolved once by the gate below, so the authorizer never re-queries per resource. */
export const isWorkflowStudioAdmin = (res: Response): boolean =>
  res.locals[ADMIN_FLAG] === true;

/**
 * Mount AFTER authMiddleware.authenticate, and only on the authenticated router
 * — the public webhook/callback routes have no user and carry a path secret.
 */
export const requireWorkflowStudioAccess = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  void (async () => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const resourceId = await workflowStudioResourceId();
    if (!resourceId) {
      logger.warn(`[WORKFLOW-SDK] resource "${WORKFLOW_STUDIO_RESOURCE}" is not configured`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // One lookup serves the gate and the admin flag. ADMIN > WRITE > READ,
    // matching resourceAccess.hasAccess.
    const grants = await repositories.resourceAccess.findUserResourceAccess(user.id, resourceId);
    const levels = new Set(grants.map(g => g.accessType));
    const isAdmin = levels.has(AccessType.ADMIN);
    const required = requiredAccessFor(req.method);
    const allowed =
      isAdmin ||
      levels.has(required) ||
      (required === AccessType.READ && levels.has(AccessType.WRITE));

    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.locals[ADMIN_FLAG] = isAdmin;
    next();
  })().catch((err: unknown) => {
    logger.error(
      `[WORKFLOW-SDK] access check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
};
