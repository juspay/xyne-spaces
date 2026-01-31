import { gcsService } from './gcsService';
import { logger } from '../utils/logger';

export class ProductInsightsService {
  /**
   * Generate GCS file path based on scope and time_range
   */
  private getFilePath(scope: String, timeRange: String): string {
    return `product_insights/TICKETS_CLUSTER_${scope}_${timeRange}.json`;
  }

  /**
   * Fetch and parse insights from GCS
   */
  async getInsights(scope: String, timeRange: String): Promise<any> {
    try {
      const filePath = this.getFilePath(scope, timeRange);
      
      logger.info(`Fetching insights from GCS: ${filePath}`);

      // Check if file exists
      const exists = await gcsService.fileExists(filePath);
      if (!exists) {
        throw new Error(`Insights file not found: ${filePath}`);
      }

      // Fetch file content as buffer
      const buffer = await gcsService.getFileBuffer(filePath);
      
      // Parse JSON
      const insights = JSON.parse(buffer.toString('utf-8'));
      
      logger.info(`Successfully fetched insights: ${filePath}`);
      
      return insights;
    } catch (error) {
      logger.error(`Failed to fetch insights for scope=${scope}, timeRange=${timeRange}:`, error);
      throw error;
    }
  }
}

export const productInsightsService = new ProductInsightsService();