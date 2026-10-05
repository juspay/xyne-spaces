import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import {
  getAuthSessionBackfillStatus,
  runAuthSessionBackfill,
  type AuthSessionBackfillOptions,
} from '@/bypassAcl/authSessionBackfillServices';

/**
 * One-off backfill: mint `auth_sessions` + `session_workspace_grants` for live legacy
 * `workflow.user_sessions` rows that have no grant yet (see bypassAcl/authSessionBackfillServices).
 *
 * Rollout: run `dryRun` first, then for real with `allOrgs:false` while AUTH_V3_ORGS names the
 * canary org, then `allOrgs:true` once AUTH_V3_ORGS=all, until `status.remaining` is 0.
 * Idempotent and resumable: pass `nextCursor` back as `cursor` to continue.
 */

const TAG = '[AuthSessionBackfill]';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const DEFAULT_DELAY_MS = 1_000;
/** Keeps one request well under proxy timeouts: 20 x (200 rows + 1s). */
const DEFAULT_MAX_BATCHES = 20;
const MAX_MAX_BATCHES = 1_000;

const runBodySchema = z
  .object({
    batchSize: z.number().int().min(1).max(MAX_BATCH_SIZE).default(DEFAULT_BATCH_SIZE),
    delayMs: z.number().int().min(0).max(60_000).default(DEFAULT_DELAY_MS),
    maxBatches: z.number().int().min(1).max(MAX_MAX_BATCHES).default(DEFAULT_MAX_BATCHES),
    dryRun: z.boolean().default(false),
    cursor: z.string().min(1).max(64).nullish(),
    allOrgs: z.boolean().default(false),
  })
  .strict();

export class AuthSessionBackfillController {
  static buildOptions(body: unknown): AuthSessionBackfillOptions {
    const parsed = runBodySchema.parse(body ?? {});
    return {
      batchSize: parsed.batchSize,
      delayMs: parsed.delayMs,
      maxBatches: parsed.maxBatches,
      dryRun: parsed.dryRun,
      cursor: parsed.cursor ?? null,
      allOrgs: parsed.allOrgs,
    };
  }

  /**
   * POST /api/admin/auth-session-backfill/run
   * Body: { batchSize?: 200, delayMs?: 1000, maxBatches?: 20, dryRun?: false, cursor?: string, allOrgs?: false }
   * Returns { batches[], totals, done, nextCursor, dryRun, allOrgs, durationMs }.
   */
  static run = async (req: Request, res: Response): Promise<void> => {
    let options: AuthSessionBackfillOptions;
    try {
      options = AuthSessionBackfillController.buildOptions(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Invalid backfill options', details: error.issues });
        return;
      }
      throw error;
    }

    logger.info(`${TAG} run requested`, { ...options });

    try {
      const result = await runAuthSessionBackfill(options);
      res.json(result);
    } catch (error) {
      logger.error(`${TAG} failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ success: false, error: 'Auth session backfill failed' });
    }
  };

  /**
   * GET /api/admin/auth-session-backfill/status
   * { legacyActive, mapped, remaining, authSessions, grants } — `remaining` is the real work
   * outstanding (live legacy rows no grant points at).
   */
  static status = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await getAuthSessionBackfillStatus();
      res.json(result);
    } catch (error) {
      logger.error(`${TAG} status failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ success: false, error: 'Failed to read backfill status' });
    }
  };
}
