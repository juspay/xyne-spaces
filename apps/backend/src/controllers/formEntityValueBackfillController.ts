import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import {
  getFormEntityValueBackfillStatus,
  runFormEntityValueBackfill,
  type FormEntityValueBackfillOptions,
} from '@/bypassAcl/formEntityValueBackfillServices';

const TAG = '[FormEntityValueBackfill]';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_DELAY_MS = 1_000;
/** Keeps one request under proxy timeouts. */
const DEFAULT_MAX_BATCHES = 20;

export class FormEntityValueBackfillController {
  private static buildOptions(body: unknown): FormEntityValueBackfillOptions {
    const payload = (body ?? {}) as Partial<FormEntityValueBackfillOptions>;
    return {
      batchSize:
        typeof payload.batchSize === 'number' && payload.batchSize > 0
          ? Math.min(Math.floor(payload.batchSize), MAX_BATCH_SIZE)
          : DEFAULT_BATCH_SIZE,
      delayMs:
        typeof payload.delayMs === 'number' && payload.delayMs >= 0 ? Math.floor(payload.delayMs) : DEFAULT_DELAY_MS,
      maxBatches:
        typeof payload.maxBatches === 'number' && payload.maxBatches > 0
          ? Math.floor(payload.maxBatches)
          : DEFAULT_MAX_BATCHES,
      dryRun: payload.dryRun === true,
      cursor: typeof payload.cursor === 'string' && payload.cursor.length > 0 ? payload.cursor : null,
    };
  }

  /**
   * POST /api/admin/form-entity-value-backfill/run
   * Body: { batchSize?: 200, delayMs?: 1000, maxBatches?: 20, dryRun?: false, cursor?: string }
   * Pass `nextCursor` from the previous response back as `cursor` to continue; repeat until `done`.
   */
  static run = async (req: Request, res: Response): Promise<void> => {
    const options = FormEntityValueBackfillController.buildOptions(req.body);
    logger.info(`${TAG} started`, { ...options });
    try {
      res.json(await runFormEntityValueBackfill(options));
    } catch (error) {
      logger.error(`${TAG} failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ success: false, error: 'Form entity value backfill failed' });
    }
  };

  /** GET /api/admin/form-entity-value-backfill/status */
  static status = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await getFormEntityValueBackfillStatus());
    } catch (error) {
      logger.error(`${TAG} status failed`, { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ success: false, error: 'Failed to read backfill status' });
    }
  };
}
