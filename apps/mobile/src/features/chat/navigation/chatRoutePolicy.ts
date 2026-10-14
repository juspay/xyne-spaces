const CHAT_BASE_STACK_ID = 'base-chat';

export const TICKET_ROUTE = '/ticket/[ticketId]';

// Keep one base-chat screen in the stack when multiple entry points push before
// the previous transition has committed.
export const baseChatRouteSingular = (): string => CHAT_BASE_STACK_ID;
