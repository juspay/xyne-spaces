import { z } from 'zod';

export type ThreadListSection = 'unread' | 'read' | 'recent';

// Sort mode for the threads inbox.
// - 'sections' (default): unread threads first, then read threads (existing behavior).
// - 'recent': a single flat list ordered by lastReplyAt desc, without a read/unread
//   divider and WITHOUT mutating read-state.
export type ThreadListSort = 'sections' | 'recent';

export interface ThreadListCursor {
  section: ThreadListSection;
  participantId: string;
}

const encodedThreadListCursorSchema = z
  .object({
    version: z.literal(1),
    section: z.enum(['unread', 'read', 'recent']),
    participantId: z.string().min(1).max(256),
  })
  .strict();

export function encodeThreadListCursor(cursor: ThreadListCursor): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      section: cursor.section,
      participantId: cursor.participantId,
    })
  ).toString('base64url');
}

export function decodeThreadListCursor(encodedCursor: string): ThreadListCursor {
  if (encodedCursor.length > 2048) {
    throw new Error('Thread list cursor is too long');
  }

  const decoded = Buffer.from(encodedCursor, 'base64url').toString('utf8');
  const cursor = encodedThreadListCursorSchema.parse(JSON.parse(decoded));

  return {
    section: cursor.section,
    participantId: cursor.participantId,
  };
}
