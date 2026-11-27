import { Request, Response } from 'express';
import { createQueryService } from '@/services/queryService/queryService';
import { DatabaseClient, readReplicaDb } from '@/database/client';
import { logger } from '@/utils/logger';
import { SUPPORTED_ENTITY_TYPES, isSupportedEntityType } from '@/services/queryService/types';
import { capacityError, queryOwner } from '@/services/queryService/queryGuards';

export class QueryController {
  /**
   * GET /api/analytics-query/fields
   * Get available fields for an entity type
   */
  public static async getFields(req: Request, res: Response): Promise<void> {
    try {
      const entityType = req.query.entityType;

      if (typeof entityType !== 'string' || !isSupportedEntityType(entityType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ENTITY_TYPE',
            message: `entityType must be one of: ${SUPPORTED_ENTITY_TYPES.join(', ')}`,
          },
        });
        return;
      }

      const prisma = DatabaseClient.getInstance();
      const queryService = createQueryService(prisma);

      const availableFields = await queryService.getAvailableFields(entityType);

      res.json({
        success: true,
        data: availableFields,
      });
    } catch (error) {
      logger.error('[analytics-query] request failed', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
        },
      });
    }
  }

  /**
   * POST /api/analytics-query
   * Execute an analytics query
   */
  public static async executeQuery(req: Request, res: Response): Promise<void> {
    try {
      const owner = queryOwner.getStore();
      const busy = owner ? capacityError(owner) : null;
      if (busy) {
        res.status(429).json({ success: false, error: { code: 'BUSY', message: busy } });
        return;
      }
      // Analytics reads stay off the primary when a replica exists.
      const prisma = readReplicaDb ?? DatabaseClient.getInstance();
      const queryService = createQueryService(prisma);

      const parseResult = queryService.parseQuery(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'PARSE_ERROR',
            message: parseResult.error || 'Invalid query format',
          },
        });
        return;
      }

      const validationResult = await queryService.validateQuery(parseResult.query!);
      if (!validationResult.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationResult.errors.join('; '),
          },
        });
        return;
      }

      const result = await queryService.execute(parseResult.query!);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error('[analytics-query] request failed', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
        },
      });
    }
  }

  /**
   * POST /api/analytics-query/validate
   * Validate a query without executing it
   */
  public static async validateQuery(req: Request, res: Response): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();
      const queryService = createQueryService(prisma);

      const parseResult = queryService.parseQuery(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'PARSE_ERROR',
            message: parseResult.error || 'Invalid query format',
          },
        });
        return;
      }

      const validationResult = await queryService.validateQuery(parseResult.query!);
      if (!validationResult.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationResult.errors.join('; '),
          },
        });
        return;
      }

      res.json({
        success: true,
        valid: true,
      });
    } catch (error) {
      logger.error('[analytics-query] request failed', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
        },
      });
    }
  }
}