import { Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import path from 'path';

// MIME type mapping for common frontend assets
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.map': 'application/json',
};

/**
 * Controller for serving frontend bundles from GCS
 */
export class BundleController {
  private static storage() {
    return getStorageService(config.gcs.bundleBucketName);
  }

  /**
   * Get content type based on file extension
   */
  private static getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Serve a file from GCS bundle bucket
   * Route: GET /api/bundles/:branchName/*
   */
  public static async serveBundle(req: Request, res: Response): Promise<void> {
    try {
      const { branchName } = req.params;
      // Capture the rest of the path after /api/bundles/:branchName/
      const filePath = req.params[0] || 'index.html';

      // Validate branch name to prevent directory traversal
      if (!branchName || branchName.includes('..') || branchName.includes('/')) {
        res.status(400).json({
          success: false,
          error: 'Invalid branch name',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Validate file path to prevent directory traversal
      if (filePath.includes('..')) {
        res.status(400).json({
          success: false,
          error: 'Invalid file path',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Construct GCS path: {branchName}/{filePath}
      const gcsPath = `${branchName}/${filePath}`;

      logger.info(`Serving bundle file from GCS: ${gcsPath}`, {
        branchName,
        filePath,
        userAgent: req.get('user-agent'),
      });

      const storage = this.storage();

      // Check if file exists
      const exists = await storage.fileExists(gcsPath);

      if (!exists) {
        // If specific file doesn't exist and path doesn't have extension, try serving index.html (for SPA routing)
        if (!path.extname(filePath)) {
          const indexPath = `${branchName}/index.html`;
          const indexExists = await storage.fileExists(indexPath);

          if (indexExists) {
            logger.info(`Serving index.html for SPA route: ${filePath}`);
            const contentType = this.getContentType('index.html');
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

            (await storage.createReadStream(indexPath)).pipe(res);
            return;
          }
        }

        logger.warn(`Bundle file not found in GCS: ${gcsPath}`);
        res.status(404).json({
          success: false,
          error: 'Bundle file not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Get file metadata for content type
      const contentType = this.getContentType(filePath);

      // Set appropriate headers
      res.setHeader('Content-Type', contentType);

      // Cache static assets aggressively, but not HTML files
      if (path.extname(filePath) === '.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        // Cache assets for 1 year (they should be versioned/hashed)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }

      // Stream file from storage to response
      const stream = await storage.createReadStream(gcsPath);
      stream
        .on('error', (error: Error) => {
          logger.error(`Error streaming bundle file from storage: ${gcsPath}`, error);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: 'Failed to stream bundle file',
              timestamp: new Date().toISOString(),
            });
          }
        })
        .pipe(res);
    } catch (error) {
      logger.error('Bundle controller error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}
