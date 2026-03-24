import type { TableName } from '../acl/core/types';

export type SideEffectOperation = 'insert' | 'update' | 'delete' | 'upsert';

export interface ConversationPreviousValue {
  channelId: string;
}

export interface TicketPreviousValue {
  assignedTo: string | null;
  stageName: string | null;
  statusV2: string | null;
  eta: number | null;
  boardId: string | null;
  createdBy: string;
  channelId: string | null;
}

export interface TicketStageEtaPreviousValue {
  stageEta: number;
  ticketId: string;
  stageId: string;
  updatedBy: string | null;
}

export interface ReactionPreviousValue {
  messageId: string;
  emojiName: string;
  userId: string;
}

export interface MessagePreviousValue {
  messageId: string;
  conversationId: string;
  senderId: string;
  msgType: string;
}

export type PreviousValue =
  | ConversationPreviousValue
  | TicketPreviousValue
  | TicketStageEtaPreviousValue
  | ReactionPreviousValue
  | MessagePreviousValue;

export interface SideEffectJobConfig {
  entityType: TableName;
  entityId: string;
  operation: SideEffectOperation;
  args?: any;
  previousValue?: PreviousValue;
}

export type SideEffectJobsAccumulator = SideEffectJobConfig[];

export type SideEffectOperationConfigMap = {
  [K in TableName]?: SideEffectOperation[];
};

export const SIDE_EFFECT_OPERATION_CONFIG: SideEffectOperationConfigMap = {
  reactions: ['insert', 'delete'],
  messages: ['insert', 'delete'],
  call_participants: ["insert", "update"],
  conversations: ['insert', 'delete'],
  calls: ['update'],
  tickets: ['update'],
  ticket_assignments: ['insert', 'update'],
  ticket_stage_eta: ['update'],
  canvases: ['insert'],
};

export function createSideEffectJobsAccumulator(): SideEffectJobsAccumulator {
  return [];
}
