import type { EntityLinkSourceType } from '@/contexts/EntityLinkContext';
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
  sourceMessageId?: string;
  entityLinkContext?: { sourceType: EntityLinkSourceType; sourceId: string };
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

export type KanbanCountsViewMode = 'project' | 'board' | 'my-tickets';

export type KanbanCountsGroupBy =
  | 'none'
  | 'assignee'
  | 'createdBy'
  | 'status'
  | 'priority'
  | 'merchantId'
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
  merchantIds?: string[];
  dynamicFields?: Record<string, string[] | { start?: number; end?: number }>;
}

export interface KanbanCountsRequest extends FlowStepVisibilityOptions {
  viewMode: KanbanCountsViewMode;
  columnType?: 'stage' | 'status';
  projectId?: string;
  boardId?: string;
  boardIds?: string[];
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

export interface Merchant {
  mid: string;
}

export interface MerchantsResponse {
  merchants: Merchant[];
  hasMore: boolean;
}

/**
 * Search merchants for the tickets Merchant ID filter. Bounded by `limit` server-side,
 * so the caller searches as the user types instead of holding the whole table.
 */
export const getMerchants = async (
  params: { q?: string; limit?: number } = {},
): Promise<MerchantsResponse> => {
  const response = await apiInstance.get<{
    success: boolean;
    merchants: Merchant[];
    hasMore: boolean;
  }>('/merchants', {
    params: {
      ...(params.q ? { q: params.q } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  return { merchants: response.data.merchants ?? [], hasMore: response.data.hasMore ?? false };
};
