import { Response, type Request } from 'express';
import { EncryptedFieldQueryError } from '@xyne/shared';
import {
  handleMutate,
  handleQueries,
  handleQueriesFallback,
  handleMutateFallback,
  handleQueriesZqlToSql,
} from '../zero/server.js';
import { redisService } from '../services/redisService.js';
import { websocketService } from '../services/websocketService.js';
import { logger } from '@/utils/logger';

function handleZeroError(res: Response, error: unknown, rateLimitMessage: string): void {
  if (error instanceof Error && error.message === 'Rate limit exceeded') {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: rateLimitMessage,
    });
    return;
  }

  if (error instanceof EncryptedFieldQueryError) {
    res.status(400).json({
      error: 'Bad request',
      message: error.message,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error'
  });
}

function hasBearer(req: Request): boolean {
  const h = req.headers.authorization;
  const value = Array.isArray(h) ? h[0] : h;
  return typeof value === 'string' && /^Bearer\s+\S+/i.test(value) && !/^Bearer\s+(null|undefined)$/i.test(value);
}

/**
 * Express request → Web API Request for the Zero server handlers.
 *
 * The route's auth middleware has already resolved the caller into `req.user` / `req.authSession`
 * and left the access JWT the request is trusted under on `req.accessToken`: the verified
 * `xw_<ws>` cookie, or the one it just minted inline from the `xs` session. Zero's own verifier
 * (`extractAuthDataFromJWT`) only understands a Bearer JWT, so that token is forwarded as
 * `Authorization: Bearer` when the request did not already carry one. A Bearer already on the
 * request is passed through unchanged. Nothing is minted here.
 */
export function toZeroRequest(req: Request): globalThis.Request {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    }
  });

  if (!hasBearer(req) && req.accessToken) {
    headers.set('authorization', `Bearer ${req.accessToken}`);
  }

  return new globalThis.Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req.body),
  });
}

export const handlePush = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handleMutate(toZeroRequest(req));

    res.json(result);
  } catch (error) {
    handleZeroError(
      res,
      error,
      'You have exceeded the maximum number of allowed mutations. Please try again later.',
    );
  }
};

export const handleGetQueries = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handleQueries(toZeroRequest(req));

    res.json(result);
  } catch (error) {
    handleZeroError(
      res,
      error,
      'You have exceeded the maximum number of allowed queries. Please try again later.',
    );
  }
};

export const handleGetQueriesFallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handleQueriesFallback(toZeroRequest(req));

    res.json(result);
  } catch (error) {
    logger.error('Fallback query error', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const handlePushFallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const fallbackConfig = await redisService.getZeroFallbackConfig();
    if (fallbackConfig.fallbackEnabled && !fallbackConfig.allowMutations) {
      res.status(403).json({
        success: false,
        error: 'mutations_disabled',
        message: 'Mutations are disabled while fallback mode is active',
      });
      return;
    }

    const result = await handleMutateFallback(toZeroRequest(req));

    res.json(result);
  } catch (error) {
    logger.error('Fallback push error', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const handleQueryZqlToSql = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handleQueriesZqlToSql(toZeroRequest(req));

    res.json(result);
  } catch (error) {
    logger.error('ZQL-to-SQL query error', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getZeroFallbackConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await redisService.getZeroFallbackConfig();
    res.json(config);
  } catch (error) {
    logger.error('Failed to get zero fallback config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const setZeroFallbackConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fallbackEnabled, allowMutations, pollIntervalMs } = req.body as {
      fallbackEnabled: boolean;
      allowMutations: boolean;
      pollIntervalMs: number;
    };

    if (typeof fallbackEnabled !== 'boolean' || typeof allowMutations !== 'boolean') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Both fallbackEnabled and allowMutations must be boolean values',
      });
      return;
    }

    if (pollIntervalMs !== undefined && (typeof pollIntervalMs !== 'number' || pollIntervalMs < 7000)) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'pollIntervalMs must be a number greater than or equal to 7000',
      });
      return;
    }

    const config = { fallbackEnabled, allowMutations, pollIntervalMs };
    await redisService.setZeroFallbackConfig(config);
    websocketService.broadcastZeroFallbackConfig(config);

    res.json({ success: true, ...config });
  } catch (error) {
    logger.error('Failed to set zero fallback config', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
