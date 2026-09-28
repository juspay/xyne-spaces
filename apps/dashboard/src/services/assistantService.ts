import type { TurnRequest, TurnResponse } from '@xyne/shared/assistant';
import { apiInstance } from './clients/apiClient';

/** The assistant backend: one call per turn of the conversation. */
export const assistantService = {
  async turn(request: TurnRequest): Promise<TurnResponse> {
    const response = await apiInstance.post<TurnResponse>('/assistant/turn', request);
    return response.data;
  },
};
