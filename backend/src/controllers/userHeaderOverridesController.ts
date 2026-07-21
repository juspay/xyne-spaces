import { Request, Response } from 'express';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

function validateUserIds(userIds: unknown): string | null {
  if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every(id => typeof id === 'string')) {
    return 'userIds must be a non-empty array of strings';
  }
  return null;
}

const MAX_TOTAL_SIZE = 4096;

const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'x-workspace-id',
  'x-user-id',
  'x-user-name',
  'x-user-email',
]);

const DEFAULT_LOADING_SECONDS = 3;

function validateSwitchOptions(
  body: { force?: unknown; loadingSeconds?: unknown },
): { force: boolean; loadingSeconds: number; error?: string } {
  const force = body.force === true;
  let loadingSeconds = DEFAULT_LOADING_SECONDS;
  if (body.loadingSeconds !== undefined) {
    const value = body.loadingSeconds;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { force, loadingSeconds, error: 'loadingSeconds must be a number' };
    }
    loadingSeconds = value;
  }
  return { force, loadingSeconds };
}

function validateHeaders(headers: unknown): { normalized?: Record<string, string>; error?: string } {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return { error: 'headers must be an object of name/value string pairs' };
  }
  const normalized: Record<string, string> = {};
  let totalSize = 0;
  for (const [rawName, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return { error: `Value for header ${rawName} must be a string` };
    }
    const name = rawName.toLowerCase();
    if (BLOCKED_HEADERS.has(name)) {
      return { error: `Header not allowed: ${rawName}` };
    }
    totalSize += name.length + value.length;
    normalized[name] = value;
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return { error: `headers too large: at most ${MAX_TOTAL_SIZE} chars in total` };
  }
  return { normalized };
}

async function publishHeadersUpdate(
  userId: string,
  headers: Record<string, string>,
  options: { force: boolean; loadingSeconds: number },
): Promise<boolean> {
  try {
    await redisService.broadcastUserEvent(userId, {
      type: 'dynamic_headers_updated',
      userId,
      data: { headers, force: options.force, loadingSeconds: options.loadingSeconds },
      timestamp: new Date(),
    });
    return true;
  } catch (error) {
    logger.error(`[USER-HEADERS] Failed to publish update for user ${userId}:`, error);
    return false;
  }
}

export const getAllHeaderOverrides = async (_req: Request, res: Response): Promise<void> => {
  try {
    const overrides = await redisService.getAllUserHeaderOverrides();
    res.json(overrides);
  } catch (error) {
    logger.error('[USER-HEADERS] Failed to get header overrides:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const setHeaderOverrides = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds, headers } = req.body as { userIds: unknown; headers: unknown };

    const userIdsError = validateUserIds(userIds);
    if (userIdsError) {
      res.status(400).json({ error: 'Invalid request', message: userIdsError });
      return;
    }
    const { normalized, error } = validateHeaders(headers);
    if (error || !normalized) {
      res.status(400).json({ error: 'Invalid request', message: error });
      return;
    }
    const { force, loadingSeconds, error: switchError } = validateSwitchOptions(
      req.body as { force?: unknown; loadingSeconds?: unknown },
    );
    if (switchError) {
      res.status(400).json({ error: 'Invalid request', message: switchError });
      return;
    }

    logger.info(`[USER-HEADERS] Admin ${req.user?.id} setting headers for ${(userIds as string[]).length} user(s) (force=${force}, loadingSeconds=${loadingSeconds}):`, normalized);

    const results = [];
    for (const userId of userIds as string[]) {
      const merged = await redisService.setUserHeaderOverrides(userId, normalized);
      const published = await publishHeadersUpdate(userId, merged, { force, loadingSeconds });
      results.push({ userId, headers: merged, published });
    }

    res.json({ success: true, results });
  } catch (error) {
    logger.error('[USER-HEADERS] Failed to set header overrides:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const removeHeaderOverrides = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds, headerNames } = req.body as { userIds: unknown; headerNames?: unknown };

    const userIdsError = validateUserIds(userIds);
    if (userIdsError) {
      res.status(400).json({ error: 'Invalid request', message: userIdsError });
      return;
    }
    if (headerNames !== undefined
      && (!Array.isArray(headerNames) || !headerNames.every(name => typeof name === 'string' && name.length > 0))) {
      res.status(400).json({ error: 'Invalid request', message: 'headerNames, when provided, must be an array of non-empty strings' });
      return;
    }
    const { force, loadingSeconds, error: switchError } = validateSwitchOptions(
      req.body as { force?: unknown; loadingSeconds?: unknown },
    );
    if (switchError) {
      res.status(400).json({ error: 'Invalid request', message: switchError });
      return;
    }

    logger.info(`[USER-HEADERS] Admin ${req.user?.id} removing ${headerNames ? (headerNames as string[]).join(', ') : 'ALL'} for ${(userIds as string[]).length} user(s) (force=${force}, loadingSeconds=${loadingSeconds})`);

    const results = [];
    for (const userId of userIds as string[]) {
      const remaining = await redisService.removeUserHeaderOverrides(userId, headerNames as string[] | undefined);
      const published = await publishHeadersUpdate(userId, remaining, { force, loadingSeconds });
      results.push({ userId, headers: remaining, published });
    }

    res.json({ success: true, results });
  } catch (error) {
    logger.error('[USER-HEADERS] Failed to remove header overrides:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getMyHeaderOverrides = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const headers = await redisService.getUserHeaderOverrides(userId);
    res.json(headers);
  } catch (error) {
    logger.error('[USER-HEADERS] Failed to get own header overrides:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
