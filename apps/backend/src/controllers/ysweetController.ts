import { Request, Response } from 'express';
import { resolveYSweetDocWorkspaceId } from '@/bypassAcl/ysweetServices';
import { canvasAuthService } from '@/services/canvasAuthService';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';
import { getTrustedOriginalHost } from '@/utils/publicUrls';
import { ysweetGetOrCreateDocAndToken } from '@/utils/ysweetUtils';
import { DatabaseClient, readReplicaDb } from '@/database/client';
import { superpositionClient } from '@/services/superpositionClient';

/**
 * y-sweet polls this every ~10s per open connection, so it's read-heavy and
 * latency-tolerant (it's a revalidation, not a first-time access decision) —
 * route it to the read replica when available so it can't add load to the
 * primary as connection count scales, same pattern as analyticsRepository.
 */
async function getValidateDbInstance() {
  let useReadReplica = false;
  try {
    useReadReplica = await superpositionClient.getBooleanValue(
      'ysweet_use_read_replica',
      false,
      {}
    );
  } catch (error) {
    logger.error('[YSweet] Failed to read ysweet_use_read_replica flag, defaulting to primary DB:', error);
  }
  if (!useReadReplica) {
    return DatabaseClient.getInstance();
  }
  if (readReplicaDb) {
    return readReplicaDb;
  }
  logger.info('[YSweet] Read replica not available, using main database for validateAccess');
  return DatabaseClient.getInstance();
}

const TOKEN_VALID_SECONDS = 3600;

const isDevelopment = config.env === 'development' || config.isTestEnv;

export class YSweetController {

  private transformUrl(
    originalUrl: string,
    protocol: 'https' | 'wss',
    originalHost: string
  ): string {
    const urlObj = new URL(originalUrl);
    const originalPath = urlObj.pathname + urlObj.search;

    let newUrl = `${protocol}://${originalHost}`;

    if (!originalPath.includes('/ysweet')) {
      newUrl += '/ysweet';
    }

    newUrl += originalPath;
    return newUrl;
  }

  private addYSweetPathIfNeeded(url: string): string {
    try {
      const urlObj = new URL(url);
      if (!urlObj.pathname.includes('/ysweet')) {
        urlObj.pathname = '/ysweet' + urlObj.pathname;
      }
      return urlObj.toString();
    } catch (error) {
      logger.error('[YSweet] Error adding /ysweet path:', error);
      return url;
    }
  }

  private processClientTokenUrls(
    clientToken: { baseUrl?: string; url?: string },
    req: Request
  ): void {
    if (isDevelopment) {
      logger.debug('[YSweet] Development environment detected, returning URLs without processing', {
        baseUrl: clientToken.baseUrl,
        url: clientToken.url,
      });
      return;
    }

    const originalHost = getTrustedOriginalHost(req);

    if (!originalHost) {
      logger.warn('[YSweet] No trusted x-original-host header found, adding /ysweet path only');
      
      if (clientToken.baseUrl) {
        clientToken.baseUrl = this.addYSweetPathIfNeeded(clientToken.baseUrl);
        logger.debug('[YSweet] Added /ysweet to baseUrl', {
          result: clientToken.baseUrl,
        });
      }

      if (clientToken.url) {
        clientToken.url = this.addYSweetPathIfNeeded(clientToken.url);
        logger.debug('[YSweet] Added /ysweet to WebSocket url', {
          result: clientToken.url,
        });
      }
      return;
    }

    logger.debug('[YSweet] Processing client token URLs for production environment', {
      originalHost,
      originalBaseUrl: clientToken.baseUrl,
      originalUrl: clientToken.url,
    });

    if (clientToken.baseUrl) {
      try {
        const newBaseUrl = this.transformUrl(clientToken.baseUrl, 'https', originalHost);
        logger.debug('[YSweet] Transformed baseUrl', {
          original: clientToken.baseUrl,
          transformed: newBaseUrl,
        });

        clientToken.baseUrl = newBaseUrl;
      } catch (error) {
        logger.error('[YSweet] Error processing baseUrl:', error);
      }
    }

    if (clientToken.url) {
      try {
        const newUrl = this.transformUrl(clientToken.url, 'wss', originalHost);
        logger.debug('[YSweet] Transformed WebSocket url', {
          original: clientToken.url,
          transformed: newUrl,
        });

        clientToken.url = newUrl;
      } catch (error) {
        logger.error('[YSweet] Error processing WebSocket url:', error);
      }
    }
  }

  async getClientToken(req: Request, res: Response): Promise<void> {
    try {
      const { docId, channelId, projectId, folderId, title } = req.body;

      if (!docId || typeof docId !== 'string') {
        res.status(400).json({
          error: 'Invalid request',
          message: 'docId is required and must be a string'
        });
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(403).json({
          error: 'Unauthorized',
          message: 'User authentication required'
        });
        return;
      }

      let authResult;
      let canEdit = false;

      try {
        authResult = await canvasAuthService.checkCanvasAccess(docId, userId);
        canEdit = authResult.canEdit;
      } catch (error) {
        logger.error('[YSweet] Error checking canvas access:', error);
        throw error;
      }

      // Backward-compat: if the client sent a legacy viewAccessId/editAccessId
      // as `docId`, `checkCanvasAccess` transparently resolved it to the
      // canonical row. Use the canonical id for both canvas creation and the
      // y-sweet doc key so we don't fork a duplicate row or a duplicate
      // y-sweet document under the legacy string.
      const canonicalDocId = authResult.canvas?.id ?? docId;

      if (authResult.crossWorkspace) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
        return;
      }

      if (!authResult.canvas) {
        try {
          await canvasAuthService.createCanvasForUser(canonicalDocId, userId, {
            channelId: typeof channelId === 'string' ? channelId : undefined,
            projectId: typeof projectId === 'string' ? projectId : undefined,
            folderId: typeof folderId === 'string' ? folderId : undefined,
            title: typeof title === 'string' ? title : undefined,
          });
          canEdit = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '';
          if (errorMessage.includes('permission to create canvas')) {
            res.status(403).json({
              error: 'Forbidden',
              message: errorMessage
            });
            return;
          }
          throw error;
        }
      } else if (!authResult.hasAccess) {
        logger.warn(`[YSweet] Access denied for user ${userId} to canvas ${canonicalDocId}`, {
          canEdit: authResult.canEdit,
          canView: authResult.canView,
          hasAccess: authResult.hasAccess,
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied'
        });
        return;
      }

      logger.debug(`[YSweet] Generating token for canvas ${canonicalDocId}`, {
        userId,
        canEdit,
        hasAccess: authResult.hasAccess,
      });

      const authorization = canvasAuthService.getYSweetAuthorizationLevel(canEdit);

      logger.debug('[YSweet] Using ENV URL for y-sweet', {
        ysweetUrl: config.ysweet.url,
      });

      const clientToken = await ysweetGetOrCreateDocAndToken(canonicalDocId, {
        authorization,
        userId,
        validForSeconds: TOKEN_VALID_SECONDS,
      });

      logger.debug('[YSweet] Received client token from y-sweet', {
        baseUrl: clientToken.baseUrl,
        url: clientToken.url,
        docId: clientToken.docId,
      });

      this.processClientTokenUrls(clientToken, req);

      logger.info('[YSweet] Returning processed client token', {
        docId: canonicalDocId,
        baseUrl: clientToken.baseUrl,
        url: clientToken.url,
      });

      res.json(clientToken);
    } catch (error) {
      logger.error('Error in getClientToken:', error);
      res.status(500).json({
        error: 'Failed to get client token'
      });
    }
  }

  /**
   * Called by the y-sweet server (not the browser) to re-validate that a
   * userId still has access to a docId before serving/mutating content or
   * upgrading a WebSocket connection. No session cookie is available here.
   */
  async validateAccess(req: Request, res: Response): Promise<void> {
    try {
      const { docId, userId, authorization } = req.body;

      if (
        !docId ||
        typeof docId !== 'string' ||
        !userId ||
        typeof userId !== 'string' ||
        (authorization !== 'full' && authorization !== 'read-only')
      ) {
        res.status(400).json({
          error: 'Invalid request',
          message: "docId, userId are required strings and authorization must be 'full' or 'read-only'",
        });
        return;
      }

      const authResult = await canvasAuthService.checkCanvasAccess(docId, userId, await getValidateDbInstance());

      // The connection was issued at `authorization` level (full = edit,
      // read-only = view). If the user's edit access was revoked since, a
      // still-open full-access connection must be denied even though they
      // may still have view access — checking `hasAccess` alone would let
      // an editor downgraded to viewer keep writing.
      const stillAllowed =
        authorization === 'full' ? authResult.canEdit : authResult.hasAccess;

      if (!authResult.canvas || !stillAllowed) {
        logger.warn('[YSweet] validateAccess denied', {
          userId,
          docId,
          authorization,
          canEdit: authResult.canEdit,
          canView: authResult.canView,
          hasAccess: authResult.hasAccess,
        });
        res.status(403).json({ allowed: false });
        return;
      }

      res.status(200).json({ allowed: true });
    } catch (error) {
      logger.error('Error in validateAccess:', error);
      res.status(500).json({ error: 'Failed to validate access' });
    }
  }

  /**
   * Called by the y-sweet server (not the browser) to get the per-doc customer-supplied
   * encryption key (CSEK) it encrypts the doc's GCS object with. y-sweet never talks to the
   * encryption service itself: a key is wrapped under the owning workspace's storage key, and
   * y-sweet knows only the doc id — the doc-to-workspace mapping lives here.
   *
   * `wrappedKey` present: unwrap the key already in the object's metadata (read path, and any
   * write to an object that is already encrypted). Absent: issue a fresh key for the doc, used
   * on its first encrypted write.
   *
   * Keys are returned as base64 and must never be logged.
   */
  async getStorageKey(req: Request, res: Response): Promise<void> {
    try {
      const { docId, wrappedKey } = req.body;

      if (!docId || typeof docId !== 'string') {
        res.status(400).json({
          error: 'Invalid request',
          message: 'docId is required and must be a string',
        });
        return;
      }

      if (wrappedKey !== undefined && (typeof wrappedKey !== 'string' || !wrappedKey)) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'wrappedKey must be a non-empty string when provided',
        });
        return;
      }

      // No doc lookup on this path: an object can outlive its canvas row, and its key still
      // has to be unwrappable so the doc stays readable.
      if (typeof wrappedKey === 'string') {
        const [key] = await getEncryptionProvider().unwrapStorageKeys([wrappedKey]);
        if (!key) {
          throw new Error(`Storage key for doc ${docId} could not be unwrapped`);
        }
        res.json({ key: key.toString('base64') });
        return;
      }

      const workspaceId = await resolveYSweetDocWorkspaceId(docId);
      if (!workspaceId) {
        logger.warn('[YSweet] getStorageKey for unknown doc', { docId });
        res.status(404).json({ error: 'Not found', message: 'Unknown docId' });
        return;
      }

      const generated = await getEncryptionProvider().generateStorageKey({ workspaceId });
      res.json({
        key: generated.key.toString('base64'),
        wrappedKey: generated.wrappedKey,
      });
    } catch (error) {
      logger.error('Error in getStorageKey:', error);
      res.status(500).json({ error: 'Failed to get storage key' });
    }
  }
}
