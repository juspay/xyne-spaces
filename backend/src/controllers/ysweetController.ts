import { Request, Response } from 'express';
import { DocumentManager } from '@y-sweet/sdk';
import { canvasAuthService } from '@/services/canvasAuthService';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getTrustedOriginalHost } from '@/utils/publicUrls';

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
      const { docId, channelId, projectId, folderId, title, viewAccessId, editAccessId } = req.body;

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

      const accessId = (typeof viewAccessId === 'string' && viewAccessId) ? viewAccessId : docId;

      try {
        authResult = await canvasAuthService.checkCanvasAccess(accessId, userId);
        canEdit = authResult.canEdit;
      } catch (error) {
        logger.error('[YSweet] Error checking canvas access:', error);
        throw error;
      }

      if (!authResult.canvas) {
        try {
          await canvasAuthService.createCanvasForUser(docId, userId, {
            channelId: typeof channelId === 'string' ? channelId : undefined,
            projectId: typeof projectId === 'string' ? projectId : undefined,
            folderId: typeof folderId === 'string' ? folderId : undefined,
            title: typeof title === 'string' ? title : undefined,
            viewAccessId: typeof viewAccessId === 'string' ? viewAccessId : undefined,
            editAccessId: typeof editAccessId === 'string' ? editAccessId : undefined,
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
        logger.warn(`[YSweet] Access denied for user ${userId} to canvas ${docId}`, {
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

      logger.debug(`[YSweet] Generating token for canvas ${docId}`, {
        userId,
        canEdit,
        hasAccess: authResult.hasAccess,
      });

      const authorization = canvasAuthService.getYSweetAuthorizationLevel(canEdit);

      logger.debug('[YSweet] Using ENV URL for DocumentManager', {
        ysweetUrl: config.ysweet.url,
      });
      const manager = new DocumentManager(config.ysweet.url);

      const clientToken = await manager.getOrCreateDocAndToken(
        docId,
        {
          authorization,
          validForSeconds: TOKEN_VALID_SECONDS,
        }
      );

      logger.debug('[YSweet] Received client token from DocumentManager', {
        baseUrl: clientToken.baseUrl,
        url: clientToken.url,
        docId: clientToken.docId,
      });

      this.processClientTokenUrls(clientToken, req);

      logger.info('[YSweet] Returning processed client token', {
        docId,
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
}
