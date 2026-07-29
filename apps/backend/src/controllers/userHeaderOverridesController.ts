import { Request, Response } from 'express';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

const CLIENT_EVENTS = ['header_update', 'reload'] as const;
type ClientEvent = (typeof CLIENT_EVENTS)[number];

const MAX_TOTAL_SIZE = 4096;
const DEFAULT_LOADING_SECONDS = 3;

const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'x-workspace-id',
  'x-user-id',
  'x-user-name',
  'x-user-email',
]);

function validateUserIds(userIds: unknown): string | null {
  if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every(id => typeof id === 'string')) {
    return 'userIds must be a non-empty array of strings';
  }
  return null;
}

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
    return { error: 'payload.headers must be an object of name/value string pairs' };
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

interface CommandOptions {
  force: boolean;
  loadingSeconds: number;
}

async function publishClientCommand(
  userId: string,
  event: ClientEvent,
  payload: Record<string, unknown>,
  options: CommandOptions,
): Promise<boolean> {
  try {
    await redisService.broadcastUserEvent(userId, {
      type: 'client_command',
      userId,
      data: { event, payload, force: options.force, loadingSeconds: options.loadingSeconds },
      timestamp: new Date(),
    });
    return true;
  } catch (error) {
    logger.error(`[CLIENT-EVENT] Failed to publish ${event} for user ${userId}:`, error);
    return false;
  }
}

export const postClientEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userIds, event, payload } = req.body as {
      userIds: unknown;
      event: unknown;
      payload?: unknown;
    };

    const userIdsError = validateUserIds(userIds);
    if (userIdsError) {
      res.status(400).json({ error: 'Invalid request', message: userIdsError });
      return;
    }
    if (typeof event !== 'string' || !CLIENT_EVENTS.includes(event as ClientEvent)) {
      res.status(400).json({ error: 'Invalid request', message: `event must be one of: ${CLIENT_EVENTS.join(', ')}` });
      return;
    }
    const { force, loadingSeconds, error: switchError } = validateSwitchOptions(
      req.body as { force?: unknown; loadingSeconds?: unknown },
    );
    if (switchError) {
      res.status(400).json({ error: 'Invalid request', message: switchError });
      return;
    }

    const rawPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    const options: CommandOptions = { force, loadingSeconds };
    const ids = userIds as string[];
    const results: Array<{ userId: string; published: boolean }> = [];

    if (event === 'header_update') {
      const { normalized, error } = validateHeaders(rawPayload.headers);
      if (error || !normalized) {
        res.status(400).json({ error: 'Invalid request', message: error });
        return;
      }
      logger.info(`[CLIENT-EVENT] Admin ${req.user?.id} header_update for ${ids.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds}):`, normalized);
      for (const userId of ids) {
        const merged = await redisService.setUserHeaderOverrides(userId, normalized);
        const published = await publishClientCommand(userId, 'header_update', { headers: merged }, options);
        results.push({ userId, published });
      }
    } else {
      logger.info(`[CLIENT-EVENT] Admin ${req.user?.id} ${event} for ${ids.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds})`);
      for (const userId of ids) {
        const published = await publishClientCommand(userId, event as ClientEvent, rawPayload, options);
        results.push({ userId, published });
      }
    }

    res.json({ success: true, event, results });
  } catch (error) {
    logger.error('[CLIENT-EVENT] Failed to push client event:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getAllHeaderOverrides = async (_req: Request, res: Response): Promise<void> => {
  try {
    const overrides = await redisService.getAllUserHeaderOverrides();
    res.json(overrides);
  } catch (error) {
    logger.error('[CLIENT-EVENT] Failed to get header overrides:', error);
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

    logger.info(`[CLIENT-EVENT] Admin ${req.user?.id} removing ${headerNames ? (headerNames as string[]).join(', ') : 'ALL'} for ${(userIds as string[]).length} user(s) (force=${force}, loadingSeconds=${loadingSeconds})`);

    const results: Array<{ userId: string; headers: Record<string, string>; published: boolean }> = [];
    for (const userId of userIds as string[]) {
      const remaining = await redisService.removeUserHeaderOverrides(userId, headerNames as string[] | undefined);
      const published = await publishClientCommand(userId, 'header_update', { headers: remaining }, { force, loadingSeconds });
      results.push({ userId, headers: remaining, published });
    }

    res.json({ success: true, results });
  } catch (error) {
    logger.error('[CLIENT-EVENT] Failed to remove header overrides:', error);
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
    logger.error('[CLIENT-EVENT] Failed to get own header overrides:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
