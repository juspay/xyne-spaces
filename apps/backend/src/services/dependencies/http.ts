import type { NextFunction, Request, Response } from 'express';
import {
  dependencyRequestMoveOptions,
  withDependencyMoveOptions,
} from '@/bypassAcl/dependencyStageGate';
import { DependencyError } from './types';

/** HTTP identity comes exclusively from the already-authenticated request, never its body. */
export function dependencyMoveContext(req: Request, res: Response, next: NextFunction): void {
  const actorId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!actorId || !workspaceId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const options = { ...dependencyRequestMoveOptions(actorId, req.body), workspaceId };
    withDependencyMoveOptions(options, next);
  } catch (error) {
    if (!sendDependencyError(error, res)) next(error);
  }
}

/** DependencyError details are count-only by construction. Never echo transport options or rows. */
export function sendDependencyError(error: unknown, res: Response): boolean {
  if (!(error instanceof DependencyError)) return false;
  res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  return true;
}
