import { Request, Response } from 'express';
import { productInsightsService } from '../services/productInsightsService';
import { logger } from '../utils/logger';
import { z } from 'zod';

// Validation schema
const ProductInsightsQuerySchema = z.object({
  scope: z.string(),
  time_range: z.string()
});

export class ProductInsightsController {
  /**
   * GET /api/productInsights
   * Fetch product insights from GCS based on scope and time_range
   */
  async getProductInsights(req: Request, res: Response): Promise<void> {
    try {
      // Validate query parameters
      const result = ProductInsightsQuerySchema.safeParse(req.query);
      
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid parameters',
          details: result.error.errors
        });
        return;
      }

      const { scope, time_range } = result.data;

      logger.info(`Fetching product insights: scope=${scope}, time_range=${time_range}`);

      // Fetch insights from service
      const insights = await productInsightsService.getInsights(scope, time_range);

      res.status(200).json({
        success: true,
        data: insights,
        metadata: {
          scope,
          time_range,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error fetching product insights:', error);
      
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Insights file not found for the specified parameters'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to fetch product insights'
      });
    }
  }
}

export const productInsightsController = new ProductInsightsController();