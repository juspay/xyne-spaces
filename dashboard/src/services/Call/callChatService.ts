import { apiInstance } from '../clients/apiClient';
import type { CallChatMessage, CallChatHistoryResponse } from '@xyne/shared';

const BASE = '/calls/chat';

/**
 * Internal (authenticated) call chat service.
 * Uses /api/calls/chat/:externalId endpoints which are behind authMiddleware.
 * Identity comes from JWT — no participantId param needed.
 */
export const callChatService = {
  async sendMessage(externalId: string, message: string): Promise<CallChatMessage> {
    const response = await apiInstance.post<CallChatMessage>(`${BASE}/${externalId}/messages`, {
      message,
    });
    return response.data;
  },

  async getMessages(
    externalId: string,
    limit?: number,
    before?: string,
  ): Promise<CallChatMessage[]> {
    const response = await apiInstance.get<{ messages: CallChatMessage[] }>(
      `${BASE}/${externalId}/messages`,
      { params: { limit, before } },
    );
    return response.data.messages;
  },

  async getChatHistory(
    externalId: string,
  ): Promise<{ messages: CallChatMessage[]; hasExternalMessages: boolean }> {
    const response = await apiInstance.get<CallChatHistoryResponse>(
      `/calls/${externalId}/chat-history`,
    );
    return {
      messages: response.data.messages,
      hasExternalMessages: response.data.hasExternalMessages,
    };
  },
};
