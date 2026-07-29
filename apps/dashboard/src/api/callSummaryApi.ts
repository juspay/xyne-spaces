import { apiInstance } from '../services/clients/apiClient';

const EDIT_SUMMARY_ERROR_MESSAGE = 'AI edit failed. Try again.';

interface EditSummaryPromptResponse {
  success: boolean;
  prompt?: string;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getSafeErrorMessage = (error: unknown): string => {
  if (!isRecord(error) || !isRecord(error['response'])) {
    return EDIT_SUMMARY_ERROR_MESSAGE;
  }

  const { data } = error['response'];
  if (!isRecord(data) || typeof data['error'] !== 'string' || !data['error'].trim()) {
    return EDIT_SUMMARY_ERROR_MESSAGE;
  }

  return data['error'];
};

export const callSummaryApi = {
  editPromptWithAI: async (
    channelId: string,
    currentPrompt: string,
    instruction: string,
  ): Promise<string> => {
    const res = await apiInstance
      .post<EditSummaryPromptResponse>('/calls/summary-prompt/edit', {
        channelId,
        currentPrompt,
        instruction,
      })
      .catch((error: unknown) => {
        throw new Error(getSafeErrorMessage(error));
      });

    if (!res.data?.success || !res.data.prompt) {
      throw new Error(res.data?.error || EDIT_SUMMARY_ERROR_MESSAGE);
    }
    return res.data.prompt;
  },
};
