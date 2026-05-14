import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
};

type BackfillSummary = {
  formsProcessed: number;
  formsUpdated: number;
  fieldsUpdated: number;
  skipped: number;
  errors: number;
};

export class FormFieldSequenceBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = body as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
    }>;

    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 100;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;

    return { batchSize, delayMs, dryRun };
  }

  private static async backfillSequenceNumbers(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      formsProcessed: 0,
      formsUpdated: 0,
      fieldsUpdated: 0,
      skipped: 0,
      errors: 0,
    };

    let cursor: string | null = null;
    let batchNumber = 0;

    let hasMore = true;

    while (hasMore) {
      batchNumber += 1;

      const forms: Array<{ id: string }> = await db.form.findMany({
        where: {
          fields: {
            some: {
              sequenceNumber: 0,
            },
          },
        },
        select: {
          id: true,
        },
        orderBy: {
          id: 'asc',
        },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      hasMore = forms.length > 0;

      if (!hasMore) {
        break;
      }

      for (const form of forms) {
        summary.formsProcessed += 1;

        try {
          const fields = await db.formFields.findMany({
            where: { formId: form.id },
            select: {
              id: true,
              sequenceNumber: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });

          if (fields.length === 0) {
            summary.skipped += 1;
            continue;
          }

          const updates = fields
            .map((field, index) => ({
              id: field.id,
              targetSequenceNumber: index + 1,
              currentSequenceNumber: field.sequenceNumber,
            }))
            .filter(field => field.currentSequenceNumber !== field.targetSequenceNumber);

          if (updates.length === 0) {
            summary.skipped += 1;
            continue;
          }

          if (!options.dryRun) {
            await db.$transaction(
              updates.map(field =>
                db.formFields.update({
                  where: { id: field.id },
                  data: { sequenceNumber: field.targetSequenceNumber },
                })
              )
            );
          }

          summary.formsUpdated += 1;
          summary.fieldsUpdated += updates.length;
        } catch (error) {
          summary.errors += 1;
          logger.warn('[FormFieldSequenceBackfill] Failed to process form', {
            formId: form.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = forms[forms.length - 1]?.id ?? null;

      logger.info(`[FormFieldSequenceBackfill] Batch #${batchNumber} completed`, {
        batchSize: forms.length,
        formsProcessed: summary.formsProcessed,
        formsUpdated: summary.formsUpdated,
        fieldsUpdated: summary.fieldsUpdated,
        skipped: summary.skipped,
        errors: summary.errors,
      });

      if (options.delayMs > 0) {
        await this.sleep(options.delayMs);
      }
    }

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>) {
    try {
      const options = FormFieldSequenceBackfillController.buildOptions(req.body);
      logger.info('[FormFieldSequenceBackfill] Starting backfill', options);

      const results = await FormFieldSequenceBackfillController.backfillSequenceNumbers(options);

      const response: ApiResponse = {
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: { options, results },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[FormFieldSequenceBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run form field sequence backfill',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }
}
