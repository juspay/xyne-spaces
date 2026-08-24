import { Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import path from 'path';

// Default bundle folder in the GCS bundle bucket. Unmapped users (and any
// request whose resolved folder is missing a file) fall back to this.
const DEFAULT_BUNDLE_FOLDER = 'default';

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
 * Controller for serving frontend bundles from GCS.
 *
 * The bundle folder is chosen by nginx (from the `x_bundle_uid` cookie via a
 * userId->folder map) and passed in as `:branchName`. This controller just
 * streams the requested file from that folder in GCS, with two fallbacks:
 *   1. Extensionless path with no matching file -> that folder's index.html (SPA).
 *   2. File missing in the requested folder -> the same file in the default
 *      folder (so a stale/typo'd override never breaks the app).
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
   * Validate + stream a single file from {branchName}/{filePath} in the GCS
   * bundle bucket, with SPA index.html fallback for extensionless routes and a
   * default-folder fallback when the file is missing in the requested folder.
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

      logger.info(`Serving bundle file from GCS: ${branchName}/${filePath}`, {
        branchName,
        filePath,
        userAgent: req.get('user-agent'),
      });

      // 1. Requested folder, exact file.
      if (await this.tryStream(res, branchName, filePath)) return;

      // 2. Extensionless route -> requested folder's index.html (SPA routing).
      if (!path.extname(filePath) && (await this.tryStream(res, branchName, 'index.html'))) {
        logger.info(`Serving index.html for SPA route: ${branchName}/${filePath}`);
        return;
      }

      // 3. Default-folder fallback (skip if we're already on the default folder).
      if (branchName !== DEFAULT_BUNDLE_FOLDER) {
        logger.warn(
          `Bundle file not found in "${branchName}", falling back to default: ${filePath}`,
        );
        if (await this.tryStream(res, DEFAULT_BUNDLE_FOLDER, filePath)) return;
        if (
          !path.extname(filePath) &&
          (await this.tryStream(res, DEFAULT_BUNDLE_FOLDER, 'index.html'))
        ) {
          return;
        }
      }

      logger.warn(`Bundle file not found in GCS (incl. default): ${branchName}/${filePath}`);
      res.status(404).json({
        success: false,
        error: 'Bundle file not found',
        timestamp: new Date().toISOString(),
      });
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

  /**
   * Stream {folder}/{filePath} from GCS if it exists. Returns true if the file
   * existed and streaming has started; false if the file was absent (caller
   * then tries the next fallback). Sets content-type + cache headers.
   */
  private static async tryStream(
    res: Response,
    folder: string,
    filePath: string,
  ): Promise<boolean> {
    const gcsPath = `${folder}/${filePath}`;
    const storage = this.storage();

    if (!(await storage.fileExists(gcsPath))) {
      return false;
    }

    const contentType = this.getContentType(filePath);
    res.setHeader('Content-Type', contentType);

    // Never cache HTML (SPA entry) or version.json; cache hashed assets hard.
    if (path.extname(filePath) === '.html' || filePath.endsWith('version.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

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
    return true;
  }
}
