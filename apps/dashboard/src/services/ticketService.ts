import { apiInstance } from './clients/apiClient';
import {
  BaseTicketType,
  TicketPriority,
  FormFieldType,
  type FlowStepVisibilityOptions,
} from '@xyne/shared';

export interface CreateTicketRequest {
  title: string;
  description: string;
  channelId: string;
  projectId?: string;
  ticketType: BaseTicketType;
  boardId?: string;
  sourceConversationId?: string;
}

export interface CreateTicketResponse {
  id: string;
  conversationId?: string;
  xyneId?: string;
}

export const createTicket = async (payload: CreateTicketRequest): Promise<CreateTicketResponse> => {
  const response = await apiInstance.post<CreateTicketResponse>('/tickets', payload);
  return response.data;
};

export type KanbanCountsViewMode =
  | 'project'
  | 'board'
  | 'my-tickets'
  | 'user-tickets'
  | 'group-tickets';

export type KanbanCountsGroupBy =
  | 'none'
  | 'assignee'
  | 'status'
  | 'priority'
  | {
      type: 'formField';
      fieldId: string;
      fieldName: string;
      fieldType: FormFieldType;
    };

export interface KanbanCountsFilters {
  priority?: TicketPriority[];
  assignee?: string[];
  userGroups?: string[];
  createdBy?: string[];
  roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
  dueDateStart?: number;
  dueDateEnd?: number;
  createdDateStart?: number;
  createdDateEnd?: number;
  boards?: string[];
  sourceChannels?: string[];
  tags?: string[];
  assigned?: boolean;
  created?: boolean;
  stages?: string[];
  ticketTypes?: string[];
  dynamicFields?: Record<string, string[] | { start?: number; end?: number }>;
}

export interface KanbanCountsRequest extends FlowStepVisibilityOptions {
  viewMode: KanbanCountsViewMode;
  columnType?: 'stage' | 'status';
  projectId?: string;
  boardId?: string;
  boardIds?: string[];
  userId?: string;
  groupId?: string;
  filters?: KanbanCountsFilters;
  groupBy?: KanbanCountsGroupBy;
  showOverdueOnly?: boolean;
}

export interface KanbanCountGroup {
  groupKey: string;
  displayName: string;
  totalCount: number;
  stages: Record<string, number>;
  statuses: Record<string, number>;
}

export interface KanbanCountsResponse {
  groups: KanbanCountGroup[];
}

export const getKanbanCounts = async (
  payload: KanbanCountsRequest,
): Promise<KanbanCountsResponse> => {
  const response = await apiInstance.post<KanbanCountsResponse>('/tickets/kanban/counts', payload);
  return response.data;
};
