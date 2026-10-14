import type { EntryPoint } from './entryPoint';
import type { OpenFailure } from '../types/openFailure';

export type Result<T, E = OpenFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type OpenSurface =
  | { kind: 'channel'; channelId: string }
  | { kind: 'thread'; channelId: string; threadId: string }
  | { kind: 'ticket-thread'; channelId: string; threadId: string; ticketId: string };

export type ListSurface = 'channels' | 'dms';

/**
 * Untrusted-link leftovers needed to finish surface resolution and re-anchor.
 * Not part of `intentKey`.
 */
export type OpenHint = {
  channelId: string;
  threadId?: string;
  ticketId?: string;
  conversationId?: string;
  messageId?: string;
  createdAt?: number;
  listSurface?: ListSurface;
  scopeType?: string;
  /** Frozen unread-open cursor from the channel-list tap (v2 `unreadOpen=1`). */
  unreadCount?: number;
  unreadBoundaryAt?: number;
  unreadBoundaryConversationId?: string;
};

export type OpenIntent = {
  /** Surface identity only — never includes the landing message (I9 + I11). */
  intentKey: string;
  surface: OpenSurface;
  entry: EntryPoint;
  isColdStart: boolean;
  /** Params as received, for invalid-intent replay. */
  raw: Readonly<Record<string, unknown>>;
  hint: OpenHint;
};

export const intentKeyFor = (surface: OpenSurface): string => {
  switch (surface.kind) {
    case 'channel':
      return `channel:${surface.channelId}`;
    case 'thread':
      return `thread:${surface.channelId}:${surface.threadId}`;
    case 'ticket-thread':
      return `ticket-thread:${surface.channelId}:${surface.threadId}:${surface.ticketId}`;
  }
};
