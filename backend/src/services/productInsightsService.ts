import { getStorageService } from './storage';
import { logger } from '../utils/logger';

const storageService = getStorageService();

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
      const exists = await storageService.fileExists(filePath);
      if (!exists) {
        throw new Error(`Insights file not found: ${filePath}`);
      }

      // Fetch file content as buffer
      const buffer = await storageService.getFileBuffer(filePath);
      
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
    const buffer = await storageService.getFileBuffer(path);
    return JSON.parse(buffer.toString('utf-8')) as T;
  }

  async uploadJsonToPath(
    path: string,
    payload: unknown,
    options: UploadJsonOptions = {},
  ): Promise<void> {
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');

    await storageService.uploadFileV2(buffer, {
      path,
      contentType: 'application/json',
      cacheControl: options.cacheControl ?? 'no-cache',
    });

    logger.info(`[ProductInsightsService] Uploaded JSON to storage: ${path}`);
  }
}

export const productInsightsService = new ProductInsightsService();
