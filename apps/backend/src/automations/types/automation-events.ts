import { EMAIL_RECEIVED_EVENT } from '../triggers/email-received.trigger';
import { MessageType, CallType } from '@xyne/shared';
import { EMAIL_SENT_EVENT } from '../triggers/email-sent.trigger';
import { TICKET_COMMENTED_EVENT } from '../triggers/ticket-commented.trigger';
import { TICKET_CREATED_EVENT } from '../triggers/ticket-created.trigger';
import {
  TICKET_UPDATED_EVENT,
  type TicketChanges,
  type FormFieldChanges,
} from '../triggers/ticket-updated.trigger';
import {
  MESSAGE_RECEIVED_EVENT,
  type MessageEventLocation,
} from './message-received-event';
import { CALL_EVENT, CALL_STARTED, CALL_ENDED } from '../triggers/call.trigger';
import { TAG_GENERATED_EVENT } from '../triggers/tag-generated.trigger';

export interface TicketCreatedEventPayload {
  ticketId: string;
  formFieldChanges?: FormFieldChanges;
  performedBy?: { id: string | null };
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

/** EMAIL_RECEIVED + EMAIL_SENT share the same wire shape. */
export interface EmailEventPayload {
  emailId: string;
  channelId?: string;
}

export interface MessageReceivedEventPayload {
  messageId: string;
  conversationId: string;
  channelId: string;
  authorId: string;
  msgType: MessageType;
  /** Optional only for executions queued before thread-reply support was deployed. */
  messageLocation?: MessageEventLocation;
}

export interface CallEventPayload {
  callEventType: typeof CALL_STARTED | typeof CALL_ENDED;
  callId: string;
  externalId: string;
  channelId: string | null;
  title: string | null;
  callType: CallType;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  aiSummary: string | null;
  transcript: string | null;
  conversationId: string | null;
}

export interface TagGeneratedEventPayload {
  sourceId: string;
  sourceType: string;
  channelId: string;
  tags: Array<{ category: string; tag: string; reason: string | null }>;
}

export type AutomationEvent =
  | { type: typeof EMAIL_RECEIVED_EVENT; payload: EmailEventPayload }
  | { type: typeof EMAIL_SENT_EVENT; payload: EmailEventPayload }
  | { type: typeof TICKET_COMMENTED_EVENT; payload: TicketCommentedEventPayload }
  | { type: typeof TICKET_CREATED_EVENT; payload: TicketCreatedEventPayload }
  | { type: typeof TICKET_UPDATED_EVENT; payload: TicketUpdatedEventPayload }
  | { type: typeof MESSAGE_RECEIVED_EVENT; payload: MessageReceivedEventPayload }
  | { type: typeof CALL_EVENT; payload: CallEventPayload }
  | { type: typeof TAG_GENERATED_EVENT; payload: TagGeneratedEventPayload };

export type AutomationEventType = AutomationEvent['type'];
