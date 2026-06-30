import { apiInstance } from './clients/apiClient';

export interface ScheduledMessage {
  id: string;
  title: string;
  messageContent: string;
  channelId: string;
  daysOfWeek: string;
  scheduledTime: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface CreateScheduledMessagePayload {
  channelId: string;
  title: string;
  messageContent: string;
  daysOfWeek: string;
  scheduledTime: string;
}

export interface UpdateScheduledMessagePayload {
  title?: string;
  messageContent?: string;
  daysOfWeek?: string;
  scheduledTime?: string;
  isActive?: boolean;
}

export const scheduledMessageApi = {
  list: async (): Promise<ScheduledMessage[]> => {
    const response = await apiInstance.get<{ scheduledMessages: ScheduledMessage[] }>(
      '/scheduled-messages',
    );
    return response.data.scheduledMessages;
  },

  create: async (payload: CreateScheduledMessagePayload): Promise<ScheduledMessage> => {
    const response = await apiInstance.post<{ scheduledMessage: ScheduledMessage }>(
      '/scheduled-messages',
      payload,
    );
    return response.data.scheduledMessage;
  },

  update: async (id: string, payload: UpdateScheduledMessagePayload): Promise<ScheduledMessage> => {
    const response = await apiInstance.put<{ scheduledMessage: ScheduledMessage }>(
      `/scheduled-messages/${id}`,
      payload,
    );
    return response.data.scheduledMessage;
  },

  delete: async (id: string): Promise<void> => {
    await apiInstance.delete(`/scheduled-messages/${id}`);
  },
};
