import { apiInstance } from './clients/apiClient';
import { BaseTicketType } from '@xyne/shared';

export interface CreateTicketRequest {
  title: string;
  description: string;
  channelId: string;
  projectId: string;
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
