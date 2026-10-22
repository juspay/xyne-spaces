import type { Conversation } from './normalizeConversationWindow';

export const injectParentTicket = (
  conversations: readonly Conversation[],
  parentTicketMd: string | null = null,
  parentTicketId: string | null = null,
): readonly Conversation[] => {
  if (conversations.length === 0 || (!parentTicketMd && !parentTicketId)) {
    return conversations;
  }
  return conversations.map((conversation, index) =>
    index === 0
      ? ({
          ...conversation,
          // Protocol field on Conversation, not a TS identifier we control.
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Zero/API column
          ticket_md: parentTicketMd ?? null,
          ticketId: parentTicketId ?? null,
        } as Conversation)
      : conversation,
  );
};
