import type { z } from 'zod';
import type { StepType } from './step-types';
import {
  EMAIL_RECEIVED_EVENT,
  EmailReceivedOutputSchema,
} from '../triggers/email-received.trigger';
import {
  EMAIL_SENT_EVENT,
  EmailSentOutputSchema,
} from '../triggers/email-sent.trigger';
import {
  TICKET_COMMENTED_EVENT,
  TicketCommentedOutputSchema,
} from '../triggers/ticket-commented.trigger';
import { TICKET_CREATED_EVENT } from '../triggers/ticket-created.trigger';
import { TICKET_UPDATED_EVENT } from '../triggers/ticket-updated.trigger';
import {
  MESSAGE_RECEIVED_EVENT,
  MessageReceivedOutputSchema,
} from '../triggers/message-received.trigger';
import {
  CALL_EVENT,
  CallEventOutputSchema,
} from '../triggers/call.trigger';
import type { TicketContext } from '../triggers/ticket-context';
import type { TicketChanges } from '../triggers/ticket-updated.trigger';

export type TriggerContext =
  | (TicketContext & {
      type: typeof TICKET_CREATED_EVENT;
      data: { ticketId: string };
    })
  | (TicketContext & {
      type: typeof TICKET_UPDATED_EVENT;
      data: { ticketId: string };
      changes: TicketChanges;
      performedBy: { id: string | null };
    })
  | (z.infer<typeof TicketCommentedOutputSchema> & {
      type: typeof TICKET_COMMENTED_EVENT;
      data: Record<string, unknown>;
    })
  | (z.infer<typeof EmailReceivedOutputSchema> & {
      type: typeof EMAIL_RECEIVED_EVENT;
      data: Record<string, unknown>;
    })
  | (z.infer<typeof EmailSentOutputSchema> & {
      type: typeof EMAIL_SENT_EVENT;
      data: Record<string, unknown>;
    })
  | (z.infer<typeof MessageReceivedOutputSchema> & {
      type: typeof MESSAGE_RECEIVED_EVENT;
      data: Record<string, unknown>;
    })
  | (z.infer<typeof CallEventOutputSchema> & {
      type: typeof CALL_EVENT;
      data: Record<string, unknown>;
    });

export interface StepContextEntry {
  type: StepType;
  input?: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface AutomationContext {
  automation: {
    id: string;
    workspaceId: string;
    createdById: string;
  };
  trigger: TriggerContext;
  steps: Record<string, StepContextEntry>;
  __meta?: {
    error?: string | null;
    chain?: readonly string[];
    /** Exact workflowStep key to resume, including nested control-flow paths. */
    resumeStepName?: string;
  };
}
