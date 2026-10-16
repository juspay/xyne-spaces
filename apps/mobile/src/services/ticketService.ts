import { TicketPriority } from '@xyne/shared';
import { apiPost } from './apiClient';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CreateTicketRequest {
  title: string;
  description: string;
  boardId: string;
  channelId: string;
  createdBy: string;
  updatedBy: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  statusV2?: string;
  stageName?: string;
  ticketType?: string;
  eta?: string;
  tags?: string[];
  merchantId?: string;
  dynamicFields?: Record<string, string | string[]>;
  projectId?: string;
  priority?: TicketPriority;
  assignedTo?: string;
  userGroupId?: string;
}

export interface CreateTicketResponse {
  id: string;
  conversationId?: string;
  xyneId?: string;
}

export const createTicket = async (payload: CreateTicketRequest): Promise<CreateTicketResponse> => {
  const body: { [key: string]: JsonValue } = {
    title: payload.title,
    description: payload.description,
    boardId: payload.boardId,
    channelId: payload.channelId,
    createdBy: payload.createdBy,
    updatedBy: payload.updatedBy,
  };

  if (payload.sourceConversationId) body['sourceConversationId'] = payload.sourceConversationId;
  if (payload.projectId) body['projectId'] = payload.projectId;
  if (payload.priority) body['priority'] = payload.priority;
  if (payload.assignedTo) body['assignedTo'] = payload.assignedTo;
  if (payload.userGroupId) body['userGroupId'] = payload.userGroupId;

  for (const key of [
    'sourceMessageId',
    'statusV2',
    'stageName',
    'ticketType',
    'eta',
    'tags',
    'merchantId',
    'dynamicFields',
  ] as const) {
    const value = payload[key];
    if (value !== undefined) body[key] = value;
  }
  return apiPost<CreateTicketResponse>('/tickets', body);
};
