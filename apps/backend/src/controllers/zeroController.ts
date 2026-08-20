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

export const handlePush = async (req: Request, res: Response): Promise<void> => {
    try {
      // Convert Express request to Web API Request
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const headers = new Headers();

      Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers.set(key, value);
        } else if (Array.isArray(value)) {
          headers.set(key, value.join(', '));
        }
      });

      // Add token from workspace-specific cookie to Authorization header for Zero
      const workspaceId = req.cookies?.xyne_last_workspace;
      if (workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]) {
        headers.set('authorization', `Bearer ${req.cookies[`xyne_ws_${workspaceId}_token`]}`);
      }

      const webRequest = new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

    const result = await handleMutate(webRequest);

    res.json(result);
  } catch (error) {
      handleZeroError(
        res,
        error,
        'You have exceeded the maximum number of allowed mutations. Please try again later.',
      );
    }
  }


export const handleGetQueries = async (req: Request, res: Response): Promise<void> => {
    try {
      // Convert Express request to Web API Request
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const headers = new Headers();

      Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers.set(key, value);
        } else if (Array.isArray(value)) {
          headers.set(key, value.join(', '));
        }
      });

      // Add token from workspace-specific cookie to Authorization header for Zero
      const workspaceId = req.cookies?.xyne_last_workspace;
      if (workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]) {
        headers.set('authorization', `Bearer ${req.cookies[`xyne_ws_${workspaceId}_token`]}`);
      }

      const webRequest = new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
      });

    const result = await handleQueries(webRequest);

    res.json(result);
  } catch (error) {
      handleZeroError(
        res,
        error,
        'You have exceeded the maximum number of allowed queries. Please try again later.',
      );
    }
  }

export const handleGetQueriesFallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // Convert Express request to Web API Request
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();

    Object.entries(req.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    });

      // Add token from workspace-specific cookie to Authorization header for Zero
      const workspaceId = req.cookies?.xyne_last_workspace;
      if (workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]) {
        headers.set('authorization', `Bearer ${req.cookies[`xyne_ws_${workspaceId}_token`]}`);
      }

    const webRequest = new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const result = await handleQueriesFallback(webRequest);

    res.json(result);
  } catch (error) {
    logger.error('Fallback query error', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

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

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();

    Object.entries(req.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    });

    // Add token from workspace-specific cookie to Authorization header
    const workspaceId = req.cookies?.xyne_last_workspace;
    if (workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]) {
      headers.set('authorization', `Bearer ${req.cookies[`xyne_ws_${workspaceId}_token`]}`);
    }

    const webRequest = new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const result = await handleMutateFallback(webRequest);

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
    // Convert Express request to Web API Request
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();

    Object.entries(req.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    });

    // Add token from workspace-specific cookie to Authorization header
    const workspaceId = req.cookies?.xyne_last_workspace;
    if (workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]) {
      headers.set('authorization', `Bearer ${req.cookies[`xyne_ws_${workspaceId}_token`]}`);
    }

    const webRequest = new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const result = await handleQueriesZqlToSql(webRequest);

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
