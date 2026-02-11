import { gcsService } from './gcsService';
import { logger } from '../utils/logger';

export interface UploadJsonOptions {
  cacheControl?: string;
}

export class ProductInsightsService {
  /**
   * Generate GCS file path based on project
   */
  getFilePath(projectId: string): string {
    return `product_insights/TICKETS_CLUSTER_${projectId}.json`;
  }

  /**
   * Fetch and parse insights from GCS
   */
  async getInsights(projectId: string): Promise<any> {
    try {
      const filePath = this.getFilePath(projectId);
      
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
      logger.error(`Failed to fetch insights for projectId=${projectId}:`, error);
      throw error;
    }
  }

  async readJsonFromPath<T = unknown>(path: string): Promise<T> {
    const buffer = await gcsService.getFileBuffer(path);
    return JSON.parse(buffer.toString('utf-8')) as T;
  }

  async uploadJsonToPath(
    path: string,
    payload: unknown,
    options: UploadJsonOptions = {},
  ): Promise<void> {
    const cacheControl = options.cacheControl ?? 'no-cache';
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bucket = (gcsService as any)['bucket'];
    if (!bucket) {
      throw new Error('GCS bucket not initialized');
    }

    const file = bucket.file(path);
    await file.save(buffer, {
      contentType: 'application/json',
      metadata: { cacheControl },
      resumable: false,
    });

    logger.info(`[ProductInsightsService] Uploaded JSON to GCS: ${path}`);
  }
}

export const productInsightsService = new ProductInsightsService();
