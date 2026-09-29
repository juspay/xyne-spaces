import type { TurnRequest, TurnResponse } from '@xyne/shared/assistant';
import { apiInstance } from './clients/apiClient';

/** The backend gives Jev 8 s a turn, then its lookups: past this, no answer is coming. */
const TURN_TIMEOUT_MS = 12_000;

/** The assistant backend: one call per turn of the conversation. */
export const assistantService = {
  async turn(sessionId: string, request: TurnRequest): Promise<TurnResponse> {
    const response = await apiInstance.post<TurnResponse>(
      `/assistant/sessions/${encodeURIComponent(sessionId)}/turns`,
      request,
      { timeout: TURN_TIMEOUT_MS },
    );
    return response.data;
  },
};
