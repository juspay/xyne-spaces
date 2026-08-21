/**
 * What the agent saw when it read a canvas.
 *
 * The read and the write are separate HTTP requests, minutes apart. Without a
 * record of which blocks were shown, a paragraph a HUMAN adds in between looks
 * — from the agent's reply — indistinguishable from a paragraph the agent
 * wants deleted. Deleting it would destroy work the agent never had an
 * opinion on.
 *
 * Short-lived by nature (an agent reads then writes within one turn), so this
 * lives in Redis rather than a table.
 */

import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export interface ReadReceipt {
  blockIds: string[];
  contentHash: string;
  readAt: number;
}

const TTL_SECONDS = 60 * 60;

const key = (canvasId: string, userId: string): string =>
  `canvas-read-receipt:${canvasId}:${userId}`;

export async function saveReadReceipt(
  canvasId: string,
  userId: string,
  receipt: ReadReceipt
): Promise<void> {
  try {
    await redisService.set(key(canvasId, userId), JSON.stringify(receipt), TTL_SECONDS);
  } catch (error) {
    logger.warn('[ReadReceipt] Failed to store receipt:', error);
  }
}

export async function getReadReceipt(
  canvasId: string,
  userId: string
): Promise<ReadReceipt | null> {
  try {
    const raw = await redisService.get(key(canvasId, userId));
    return raw ? (JSON.parse(raw) as ReadReceipt) : null;
  } catch (error) {
    logger.warn('[ReadReceipt] Failed to read receipt:', error);
    return null;
  }
}

export async function clearReadReceipt(canvasId: string, userId: string): Promise<void> {
  try {
    await redisService.del(key(canvasId, userId));
  } catch {
    /* best effort */
  }
}
