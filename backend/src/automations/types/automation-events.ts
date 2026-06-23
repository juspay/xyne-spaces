import { EMAIL_RECEIVED_EVENT } from '../triggers/email-received.trigger';
import { EMAIL_SENT_EVENT } from '../triggers/email-sent.trigger';
import { TICKET_COMMENTED_EVENT } from '../triggers/ticket-commented.trigger';
import { TICKET_CREATED_EVENT } from '../triggers/ticket-created.trigger';
import {
  TICKET_UPDATED_EVENT,
  type TicketChanges,
  type FormFieldChanges,
} from '../triggers/ticket-updated.trigger';
import { MESSAGE_RECEIVED_EVENT } from '../triggers/message-received.trigger';
import type { MessageType } from '@prisma/client';

export interface TicketCreatedEventPayload {
  ticketId: string;
}

export interface TicketUpdatedEventPayload {
  ticketId: string;
  changes: TicketChanges;
  formFieldChanges?: FormFieldChanges;
  performedBy: { id: string | null };
}

export interface TicketCommentedEventPayload {
  ticketId: string;
  messageId: string;
  conversationId: string;
  authorId: string;
}

/** EMAIL_RECEIVED + EMAIL_SENT share the same wire shape — only id. */
export interface EmailEventPayload {
  emailId: string;
}

export interface MessageReceivedEventPayload {
  messageId: string;
  conversationId: string;
  channelId: string;
  authorId: string;
  msgType: MessageType;
}

export type AutomationEvent =
  | { type: typeof EMAIL_RECEIVED_EVENT; payload: EmailEventPayload }
  | { type: typeof EMAIL_SENT_EVENT; payload: EmailEventPayload }
  | { type: typeof TICKET_COMMENTED_EVENT; payload: TicketCommentedEventPayload }
  | { type: typeof TICKET_CREATED_EVENT; payload: TicketCreatedEventPayload }
  | { type: typeof TICKET_UPDATED_EVENT; payload: TicketUpdatedEventPayload }
  | { type: typeof MESSAGE_RECEIVED_EVENT; payload: MessageReceivedEventPayload };

export type AutomationEventType = AutomationEvent['type'];
