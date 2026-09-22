import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AccessType, SDLC_GITHUB_HOST } from '@xyne/shared';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { logger } from '@/utils/logger';
import { SDLC_VCS_EXTERNAL_SOURCE_TYPE } from '@/sdlc/vcs/SdlcVcsCredentialStore';
import { repositoryHost } from '@/sdlc/vcs/repositoryHost';

const router = Router();
const adminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);
const TAG = '[sdlc-repo-credential-backfill]';

// Links GitHub repositories to the workspace's legacy single credential. Only null links are touched.
async function backfill(dryRun: boolean) {
  return runAsSystem(async () => {
    const legacy = await db.externalSource.findMany({
      where: {
        sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE,
        externalIdentifier: 'GITHUB',
        name: { endsWith: ':github' },
      },
      select: { id: true, workspaceId: true },
    });
    const workspaces = [];
    let pending = 0;
    let updated = 0;
    for (const credential of legacy) {
      const repos = await db.repo.findMany({
        where: { workspaceId: credential.workspaceId, vcsCredentialId: null, projectId: { not: null } },
        select: { id: true, url: true, canonicalUrl: true },
      });
      const repoIds = repos
        .filter((repo) => {
          try {
            return repositoryHost(repo.canonicalUrl || repo.url) === SDLC_GITHUB_HOST;
          } catch {
            return false;
          }
        })
        .map((repo) => repo.id);
      pending += repoIds.length;
      if (!dryRun && repoIds.length > 0) {
        const result = await db.repo.updateMany({
          where: { id: { in: repoIds }, vcsCredentialId: null },
          data: { vcsCredentialId: credential.id },
        });
        updated += result.count;
      }
      workspaces.push({ workspaceId: credential.workspaceId, credentialId: credential.id, repoIds });
    }
    return { dryRun, legacyCredentials: legacy.length, pending, updated, workspaces };
  });
}

function route(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

/** @route GET /api/admin/sdlc-repo-credential-backfill/status — `pending` is the work left. */
router.get(
  '/status',
  authMiddleware.authenticate,
  adminAuth,
  route(async (_req, res) => {
    const { pending, legacyCredentials } = await backfill(true);
    res.status(200).json({ success: true, pending, legacyCredentials });
  })
);

/** @route POST /api/admin/sdlc-repo-credential-backfill/run — body `{ dryRun?: true }`. */
router.post(
  '/run',
  authMiddleware.authenticate,
  adminAuth,
  route(async (req, res) => {
    const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await backfill(dryRun);
    logger.info(`${TAG} finished`, { dryRun, pending: result.pending, updated: result.updated });
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
