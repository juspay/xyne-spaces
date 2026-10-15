import { z } from 'zod';

import type { ListSurface } from './openIntent.types';

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/** Expo may pass `string | string[]`. Always take the first element. */
export const firstParam = (value: unknown): string => {
  const raw = first(value);
  return typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
};

const optionalParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): string | undefined => {
    const raw = first(value);
    if (typeof raw !== 'string') {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

const optionalCreatedAt = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .optional()
  .transform((value): number | undefined => {
    const raw = first(value);
    const parsed =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  });

const optionalListSurface = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): ListSurface | undefined => {
    const raw = first(value);
    return raw === 'channels' || raw === 'dms' ? raw : undefined;
  });

/**
 * Zod boundary over Expo route params (string | string[] | number).
 * Unknown keys are stripped here; `parseOpenIntent` keeps the original `raw`.
 */
export const openIntentParamsSchema = z.object({
  channelId: optionalParam,
  threadId: optionalParam,
  ticketId: optionalParam,
  conversationId: optionalParam,
  origin: optionalParam,
  messageId: optionalParam,
  createdAt: optionalCreatedAt,
  surface: optionalListSurface,
  scopeType: optionalParam,
  source: optionalParam,
  from: optionalParam,
  resolving: optionalParam,
  unreadOpen: optionalParam,
  unreadCount: optionalCreatedAt,
  unreadLastViewedAt: optionalCreatedAt,
  unreadLastViewedConversationId: optionalParam,
  isColdStart: z.union([z.boolean(), z.string(), z.array(z.string())]).optional(),
});

export type OpenIntentParams = z.output<typeof openIntentParamsSchema>;
