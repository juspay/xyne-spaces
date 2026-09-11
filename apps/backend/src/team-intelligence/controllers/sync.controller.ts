import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import {
  formatTeamIntelligenceValidationErrors,
  TeamIntelligenceSyncRequestSchema,
} from '../validation';
import {
  teamIntelligenceService,
  TeamIntelligenceIdempotencyConflictError,
} from '../services/team-intelligence.service';

function extractHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return value?.trim() || undefined;
}

export class TeamIntelligenceSyncController {
  ingestDailyBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const validationResult = TeamIntelligenceSyncRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        const validationErrors = formatTeamIntelligenceValidationErrors(
          validationResult.error.issues
        );
        logger.warn('[TeamIntelligenceSyncController] Invalid ingestion payload received', {
          path: req.path,
          source:
            extractHeaderValue(req.headers['x-source']) ??
            (typeof req.body?.source === 'string' ? req.body.source : 'mettle'),
          requestId:
            extractHeaderValue(req.headers['x-request-id']) ??
            (typeof req.body?.requestId === 'string' ? req.body.requestId : undefined),
          mismatchedFields: [...new Set(validationErrors.map((error) => error.fieldPath))],
          validationErrors,
        });

        res.status(400).json({
          error: 'Invalid input',
          details: validationResult.error.flatten(),
        });
        return;
      }

      const idempotencyKey = extractHeaderValue(req.headers['idempotency-key']);
      const requestId = extractHeaderValue(req.headers['x-request-id']);
      const source = extractHeaderValue(req.headers['x-source']) ?? validationResult.data.source ?? 'mettle';

      if (!idempotencyKey) {
        res.status(400).json({
          error: 'Invalid input',
          details: {
            fieldErrors: {
              'idempotency-key': ['idempotency-key header is required'],
            },
            formErrors: [],
          },
        });
        return;
      }

      const response = await teamIntelligenceService.ingestSyncRequest(validationResult.data, {
        idempotencyKey,
        source,
        requestId,
      });

      res.status(202).json({
        success: true,
        data: response,
      });
    } catch (error) {
      if (error instanceof TeamIntelligenceIdempotencyConflictError) {
        res.status(409).json({
          success: false,
          error: error.message,
        });
        return;
      }

      logger.error('[TeamIntelligenceSyncController] Failed to ingest daily payload', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to ingest team intelligence payload',
      });
    }
  };

  getOrgSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const batchId = req.params.batchId?.trim();
      if (!batchId) {
        res.status(400).json({
          success: false,
          error: 'batchId is required',
        });
        return;
      }

      const orgSummary = await teamIntelligenceService.getOrgSummaryByBatchId(batchId);
      if (!orgSummary) {
        res.status(404).json({
          success: false,
          error: 'Org summary not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: orgSummary,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceSyncController] Failed to fetch org summary', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch org summary',
      });
    }
  };
}

export const teamIntelligenceSyncController = new TeamIntelligenceSyncController();
