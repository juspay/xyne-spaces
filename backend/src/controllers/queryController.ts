import { Request, Response } from 'express';
import { createQueryService } from '@/services/queryService/queryService';
import { DatabaseClient } from '@/database/client';

export class QueryController {
  /**
   * GET /api/analytics-query/fields
   * Get available fields for an entity type
   */
  public static async getFields(req: Request, res: Response): Promise<void> {
    try {
      const entityType = req.query.entityType as string;

      if (!entityType) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_ENTITY_TYPE',
            message: 'entityType query parameter is required',
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
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
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

      const result = await queryService.execute(parseResult.query!);

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
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
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
}