import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

/** The paint builder's stand-in sender for a message that names none. */
const SYSTEM_SENDER_ID = 'system';

export type RowFacts = {
  hasConversation: boolean;
  rowKind: 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'TICKET' | 'SYSTEM';
  isTicketActivity: boolean;
  hasTicketPreview: boolean;
  /** The message names who sent it; a ticket-created notice may not. */
  hasSender: boolean;
  hasRecordingPreview: boolean;
  isFlowJson: boolean;
};

/**
 * Rows the flat layout does not restyle. They keep the classic row because
 * their whole look is chrome Figma has not drawn for the flat layout (call
 * and system lines, ticket activity, recordings, flow cards), and because a
 * row with no hydrated conversation has nothing for the flat body to render
 * yet. A ticket card is drawn flat under its sender; a ticket-created notice
 * that names no sender keeps the classic card, as the flat row would have no
 * one to put above it.
 */
export function usesClassicRow(facts: RowFacts): boolean {
  return (
    !facts.hasConversation ||
    facts.rowKind === 'SYSTEM' ||
    (facts.rowKind === 'TICKET' && !(facts.hasTicketPreview && facts.hasSender)) ||
    facts.isTicketActivity ||
    facts.hasRecordingPreview ||
    facts.isFlowJson
  );
}

type RestyleFacts = {
  /** Defaults to true: a row judged from its paint alone is taken as hydrated. */
  hasConversation?: boolean;
  /** Whether the conversation's first message is a flow card; only its conversation knows. */
  isFlowJson?: boolean;
};

/** Whether the flat layout draws this paint row itself (see `usesClassicRow`). */
export function isRestyledRow(
  row: ChatPaintRow,
  { hasConversation = true, isFlowJson = false }: RestyleFacts = {},
): boolean {
  const senderId = row.senderPaintModel.senderId;
  return !usesClassicRow({
    hasConversation,
    rowKind: row.rowKind,
    isTicketActivity: row.isTicketActivity === true,
    hasTicketPreview: !!row.ticketPreview,
    hasSender: !!senderId && senderId !== SYSTEM_SENDER_ID,
    hasRecordingPreview: !!row.recordingPreview,
    isFlowJson,
  });
}
