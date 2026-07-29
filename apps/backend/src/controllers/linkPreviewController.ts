import { Request, Response } from 'express';
import { linkPreviewService } from '../services/linkPreviewService';
import { logger } from '../utils/logger';

export class LinkPreviewController {
  /**
   * Fetch link preview metadata for a URL
   * POST /api/link-preview
   * Body: { url: string }
   */
  async fetchPreview(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: 'URL is required',
        });
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid URL format',
        });
        return;
      }

      logger.info(`Fetching link preview for: ${url}`);

      // Fetch metadata
      const metadata = await linkPreviewService.fetchMetadata(url);

      res.json({
        success: true,
        data: metadata,
      });
    } catch (error: any) {
      logger.error('Error fetching link preview:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch link preview',
        message: error.message,
      });
    }
  }
}

export const linkPreviewController = new LinkPreviewController();
