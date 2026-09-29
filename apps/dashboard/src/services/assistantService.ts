import type { TurnRequest, TurnResponse } from '@xyne/shared/assistant';
import { apiInstance } from './clients/apiClient';

/** The assistant backend: one call per turn of the conversation. */
export const assistantService = {
  async turn(sessionId: string, request: TurnRequest): Promise<TurnResponse> {
    const response = await apiInstance.post<TurnResponse>(
      `/assistant/sessions/${encodeURIComponent(sessionId)}/turns`,
      request,
    );
    return response.data;
  },
};
