import { Request, Response, Router } from 'express';
import { AccessType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

const TAG = '[SdlcAccessBackfill]';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const BATCH_DELAY_MS = 10_000;

const DEFAULT_RESOURCE_NAME = 'SDLC';
const DEFAULT_ACCESS_TYPE = 'WRITE';
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 200;

interface BackfillBody {
  workspaceId?: unknown;
  resourceName?: unknown;
  accessType?: unknown;
  batchSize?: unknown;
  dryRun?: unknown;
}

interface BackfillParams {
  workspaceId: string;
  resourceName: string;
  accessType: string;
  batchSize: number;
  dryRun: boolean;
}

function parseBody(body: BackfillBody): BackfillParams {
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
  if (!workspaceId) throw new Error('workspaceId is required');
  const resourceName =
    typeof body.resourceName === 'string' && body.resourceName.trim()
      ? body.resourceName.trim()
      : DEFAULT_RESOURCE_NAME;
  const accessType =
    typeof body.accessType === 'string' && body.accessType.trim()
      ? body.accessType.trim().toUpperCase()
      : DEFAULT_ACCESS_TYPE;
  if (!['READ', 'WRITE', 'ADMIN'].includes(accessType)) {
    throw new Error('accessType must be READ, WRITE, or ADMIN');
  }
  const batchSize = body.batchSize === undefined ? DEFAULT_BATCH_SIZE : Number(body.batchSize);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return { workspaceId, resourceName, accessType, batchSize, dryRun: body.dryRun !== false };
}

async function runBackfill(params: BackfillParams, resourceId: string): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let granted = 0;
  let skipped = 0;
  let batches = 0;

  for (;;) {
    const users = await db.user.findMany({
      where: { workspaceId: params.workspaceId, userType: 'USER', status: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: params.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (users.length === 0) break;
    batches += 1;
    scanned += users.length;
    cursor = users[users.length - 1]!.id;

    const userIds = users.map((user) => user.id);
    const existing = await db.resourceAccess.findMany({
      where: { resourceId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((row) => row.userId));
    const missingIds = userIds.filter((id) => !existingIds.has(id));
    skipped += userIds.length - missingIds.length;

    if (missingIds.length > 0 && !params.dryRun) {
      const result = await db.resourceAccess.createMany({
        data: missingIds.map((userId) => ({
          workspaceId: params.workspaceId,
          userId,
          resourceId,
          accessType: params.accessType,
        })),
        skipDuplicates: true,
      });
      granted += result.count;
    } else {
      granted += missingIds.length;
    }

    logger.info(`${TAG} batch ${batches}: scanned=${users.length} granted=${missingIds.length} skipped=${userIds.length - missingIds.length}`);
    if (users.length < params.batchSize) break;
    await sleep(BATCH_DELAY_MS);
  }

  logger.info(
    `${TAG} completed dryRun=${params.dryRun} resource=${params.resourceName} accessType=${params.accessType} batches=${batches} scanned=${scanned} granted=${granted} skipped=${skipped}`,
  );
}

export class SdlcAccessBackfillController {
  /**
   * Kick off the backfill: grant the resource access to every ACTIVE user
   * (userType USER) in the workspace that does not already have ANY access
   * row for the resource. One resource_access row per user; users with an
   * existing row (any accessType) are skipped. Batches of batchSize with a
   * pause between them.
   *
   * Responds 202 immediately after validation; the backfill runs in the
   * background — monitor progress and the final summary in the logs.
   *
   * SAFETY: dryRun defaults to true — a preview run (no rows created, logs
   * report what WOULD be granted) unless the caller explicitly sends
   * dryRun: false. Idempotent — safe to re-run.
   */
  static run = async (req: Request, res: Response): Promise<void> => {
    try {
      const params = parseBody(req.body as BackfillBody);
      const resource = await db.resource.findUnique({ where: { name: params.resourceName } });
      if (!resource) {
        res.status(404).json({ success: false, error: `Resource '${params.resourceName}' not found` });
        return;
      }

      logger.info(
        `${TAG} started workspaceId=${params.workspaceId} resource=${params.resourceName} accessType=${params.accessType} batchSize=${params.batchSize} dryRun=${params.dryRun}`,
      );
      void runBackfill(params, resource.id).catch((error) => {
        logger.error(`${TAG} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      res.status(202).json({
        success: true,
        message: 'Backfill started — monitor progress in logs',
        resourceName: params.resourceName,
        accessType: params.accessType,
        batchSize: params.batchSize,
        dryRun: params.dryRun,
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

/**
 * POST /api/sdlc-backfill/run
 *   Body: { workspaceId, batchSize? = 10, resourceName? = 'SDLC',
 *           accessType? = 'WRITE', dryRun? = true }
 *   dryRun defaults to true (preview); send dryRun: false to perform writes.
 *   Responds 202 immediately; the backfill runs async — monitor in logs.
 * Access: USER-MANAGEMENT Admin only.
 */
export const sdlcAccessBackfillRouter = Router();
sdlcAccessBackfillRouter.post(
  '/run',
  authMiddleware.authenticate,
  authorize('USER-MANAGEMENT', AccessType.ADMIN),
  SdlcAccessBackfillController.run,
);
