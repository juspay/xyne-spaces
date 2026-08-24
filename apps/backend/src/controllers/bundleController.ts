import { Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { BundleOverrideService } from '@/services/bundleOverrideService';
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
   * Serve a file from GCS bundle bucket for an explicit branch/folder.
   * Route: GET /api/bundles/:branchName/*
   */
  public static async serveBundle(req: Request, res: Response): Promise<void> {
    const { branchName } = req.params;
    // Capture the rest of the path after /api/bundles/:branchName/
    const filePath = req.params[0] || 'index.html';
    await this.streamBundleFile(req, res, branchName, filePath);
  }

  /**
   * Serve a file from the bundle folder resolved for the authenticated user.
   * Route: GET /api/bundles/me/*  (optionalAuthenticate)
   *
   * If the user has an enabled override row, that folder is served; otherwise
   * the configured default bundle folder is served. Unauthenticated requests
   * also get the default bundle.
   */
  public static async serveUserBundle(req: Request, res: Response): Promise<void> {
    // req.params[0] is the wildcard portion after /api/bundles/me/
    const filePath = req.params[0] || 'index.html';
    const userId = req.user?.id;
    const branchName = await BundleOverrideService.resolveBundleName(userId);

    logger.info(`Resolved user bundle folder`, {
      userId: userId ?? 'anonymous',
      branchName,
      filePath,
    });

    await this.streamBundleFile(req, res, branchName, filePath);
  }

  /**
   * Shared logic: validate + stream a single file from {branchName}/{filePath}
   * in the GCS bundle bucket, with SPA index.html fallback for extensionless
   * routes and appropriate cache headers.
   */
  private static async streamBundleFile(
    req: Request,
    res: Response,
    branchName: string,
    filePath: string,
  ): Promise<void> {
    try {
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

  // ---------------------------------------------------------------------------
  // Admin CRUD for per-user bundle overrides (requireAdmin — see routes)
  // ---------------------------------------------------------------------------

  /** GET /api/bundles/admin/overrides */
  public static async listOverrides(_req: Request, res: Response): Promise<void> {
    try {
      const overrides = await BundleOverrideService.list();
      res.json({
        success: true,
        data: { overrides, defaultBundleName: BundleOverrideService.getDefaultBundleName() },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[BundleOverride] listOverrides error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list bundle overrides',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** POST /api/bundles/admin/overrides  body: { userId, bundleName, enabled?, note? } */
  public static async upsertOverride(req: Request, res: Response): Promise<void> {
    try {
      const { userId, bundleName, enabled, note } = req.body ?? {};

      if (!userId || typeof userId !== 'string' || !bundleName || typeof bundleName !== 'string') {
        res.status(400).json({
          success: false,
          error: 'userId and bundleName are required strings',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Reject folder names that would escape the bucket prefix
      if (bundleName.includes('..') || bundleName.includes('/')) {
        res.status(400).json({
          success: false,
          error: 'Invalid bundleName',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const override = await BundleOverrideService.upsert({
        userId,
        bundleName,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        note: typeof note === 'string' ? note : null,
      });

      res.json({ success: true, data: override, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('[BundleOverride] upsertOverride error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to save bundle override',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** DELETE /api/bundles/admin/overrides/:userId */
  public static async deleteOverride(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const existing = await BundleOverrideService.getByUserId(userId);

      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'Override not found',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await BundleOverrideService.remove(userId);
      res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('[BundleOverride] deleteOverride error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete bundle override',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
