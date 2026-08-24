import { Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { BundleOverrideService } from '@/services/bundleOverrideService';
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
 * nginx proxies every bundle request to the backend; the backend is the only
 * thing that reads GCS. Two entry points:
 *   - serveUserBundle (GET /api/bundles/me/*): resolves the folder from the
 *     VERIFIED JWT (req.user.id, set by optionalAuthenticate) via the
 *     UserBundleOverride table, defaulting to "default". This is the secure,
 *     per-user path — the userId comes from a validated token, not a spoofable
 *     header/cookie.
 *   - serveBundle (GET /api/bundles/:branchName/*): explicit folder (used by the
 *     existing devqa User-Agent path in nginx).
 *
 * Both stream via streamBundleFile with layered fallback:
 *   1. Extensionless path with no matching file -> that folder's index.html (SPA).
 *   2. File missing in the requested folder -> same file in the default folder
 *      (so a stale/typo'd override never breaks the app).
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
   * The userId comes from the VERIFIED JWT (req.user.id). If the user has an
   * enabled override row, that folder is served; otherwise (no/expired token,
   * no row, or disabled) the default folder is served.
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

  // ---------------------------------------------------------------------------
  // Admin CRUD for per-user bundle overrides (authenticate + requireAdmin — see routes)
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
