/** §8.1 reuse gate: **Adopt**. Characterised against v2 getConversationKind. Pure. */

import { MessageType, type InitialMessageSummary } from '@xyne/shared';

export type ConversationKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';

const parseMetadata = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const getConversationKind = (
  summary: InitialMessageSummary | null,
  currentUserId: string | undefined,
): ConversationKind => {
  if (!summary) return 'SYSTEM';

  if (summary.msgType === MessageType.BOT) return 'BOT';

  if (summary.msgType === MessageType.SYSTEM) {
    const metadata = parseMetadata(summary.metadata);
    if (metadata?.['isTicketActivity'] === true) {
      return 'SYSTEM';
    }
    if (metadata?.['ticketId'] !== undefined) {
      return 'TICKET';
    }
    return 'SYSTEM';
  }

  if (summary.senderId && currentUserId && summary.senderId === currentUserId) {
    return 'CURRENT_USER';
  }

  return 'OTHER_USER';
};
