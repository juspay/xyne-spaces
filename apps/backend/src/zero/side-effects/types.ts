import type { TableName } from '../acl/core/types';
export type SideEffectOperation = 'insert' | 'update' | 'delete' | 'upsert';

export interface ConversationPreviousValue {
  channelId: string;
}

export interface TicketPreviousValue {
  assignedTo: string | null;
  stageName: string | null;
  statusV2: string | null;
  priority: string | null;
  title: string | null;
  description: string | null;
  eta: number | null;
  boardId: string | null;
  userGroupId: string | null;
  createdBy: string;
  channelId: string | null;
  /**
   * Pre-write `Ticket.metadata`. Needed so the handler can diff the ETA
   * planning-risk state (`metadata.etaManagement.planningRisk`) that the
   * mutation just wrote, and decide whether a risk was newly detected or
   * reopened. Free to include: the collector already loads the whole row.
   */
  metadata: unknown;
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
  content?: string;
  isDeleted?: boolean;
  channelId?: string;
  isThreadReply: boolean;
}

export interface TicketTagPreviousValue {
  tagName: string;
  ticketId: string;
}

export interface FormEntityValuePreviousValue {
  entityId: string;
  fieldId: string;
  entityType: string;
  fieldValue: string;
  actualFieldValue: unknown;
}

export interface DelayedMessagePreviousValue {
  scheduledFor: number;
  status: string;
}

export interface ChannelPreviousValue {
  name: string;
  scopeType: string | null;
}

export interface EmailReadPreviousValue {
  lastReadEmailId: string;
}

export interface CanvasParticipantPreviousValue {
  canvasId: string;
  userId: string | null;
  userGroupId?: string | null;
  channelId?: string | null;
  role: string;
}

export interface UserGroupMappingPreviousValue {
  userGroupId: string;
  userId: string;
}

export interface ChannelParticipantPreviousValue {
  channelId: string;
  userId: string;
}

export interface ChannelUserStatusPreviousValue {
  lastViewedAt: number | null;
  unreadCount: number;
  channelId: string;
  userId: string;
}

export interface ConversationParticipantPreviousValue {
  lastReadAt: number | null;
  lastReplyAt: number | null;
  conversationId: string;
  userId: string;
}

export type PreviousValue =
  | ConversationPreviousValue
  | TicketPreviousValue
  | TicketStageEtaPreviousValue
  | ReactionPreviousValue
  | MessagePreviousValue
  | TicketTagPreviousValue
  | FormEntityValuePreviousValue
  | DelayedMessagePreviousValue
  | ChannelPreviousValue
  | EmailReadPreviousValue
  | CanvasParticipantPreviousValue
  | UserGroupMappingPreviousValue
  | ChannelParticipantPreviousValue
  | ChannelUserStatusPreviousValue
  | ConversationParticipantPreviousValue
  | TicketStageRequestPreviousValue;

export interface TicketStageRequestPreviousValue {
  status: string;
  stageId: string;
  submittedBy: string;
  ticketId: string;
}

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
  messages: ['insert', 'delete', 'update'],
  ticket_tags: ['insert', 'update', 'delete'],
  ticket_tag_mappings: ['insert', 'update', 'delete'],
  call_participants: ["insert", "update"],
  channel_participants: ['insert', 'delete'],
  canvas_participants: ['insert', 'update', 'delete'],
  user_group_mappings: ['insert', 'delete'],
  conversations: ['insert', 'delete'],
  calls: ['update'],
  tickets: ['update'],
  ticket_assignments: ['insert', 'update'],
  ticket_stage_eta: ['insert', 'update', 'delete', 'upsert'],
  rcas: ['insert', 'update'],
  ticket_sub_ticket_mappings: ['insert'],
  ticket_reference_mappings: ['insert', 'delete'],
  canvases: ['insert'],
  form_entity_values: ['insert', 'update', 'delete'],
  delayed_messages: ['insert', 'update', 'delete'],
  channels: ['update'],
  email_reads: ['insert', 'update'],
  channel_user_status: ['update'],
  conversation_participants: ['update'],
  ticket_stage_requests: ['insert', 'update', 'upsert'],
};

export function createSideEffectJobsAccumulator(): SideEffectJobsAccumulator {
  return [];
}
