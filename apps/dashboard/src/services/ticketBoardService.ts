import { apiInstance } from './clients/apiClient';

export interface TicketBoardSuggestionRequest {
  title: string;
  description: string;
  projectId: string;
}

export interface TicketBoardCandidate {
  id: string;
  name: string;
  description?: string;
  boardType?: string;
  stageCount?: number;
}

export interface TicketBoardAnalysis {
  suggestedBoardId: string | null;
  suggestedBoardName: string | null;
  error?: string;
}

export interface TicketBoardSuggestionResponse {
  candidates: TicketBoardCandidate[];
  analysis: TicketBoardAnalysis;
}

interface TicketBoardApiResponse {
  success: boolean;
  data?: TicketBoardSuggestionResponse;
  error?: string;
}

interface ReleaseNotesApiResponse {
  success: boolean;
  error?: string;
}

export const checkBoardSuggestion = async (
  payload: TicketBoardSuggestionRequest,
  options?: { signal?: AbortSignal },
): Promise<TicketBoardSuggestionResponse> => {
  const requestConfig = options?.signal ? { signal: options.signal } : undefined;
  const response = await apiInstance.post<TicketBoardApiResponse>(
    '/tickets/suggest-board',
    payload,
    requestConfig,
  );
  const responseData: TicketBoardApiResponse = response.data;

  if (!responseData.success || !responseData.data) {
    throw new Error(responseData.error || 'Board suggestion failed');
  }

  return responseData.data;
};

export interface TicketFieldSuggestions {
  board?: { id: string; confidence: number };
  ticketType?: { type: string; confidence: number };
}

export const suggestTicketFields = async (
  payload: {
    title: string;
    description: string;
    boards: { id: string; name: string; description?: string }[];
  },
  options?: { signal?: AbortSignal },
): Promise<TicketFieldSuggestions> => {
  const requestConfig = options?.signal ? { signal: options.signal } : undefined;
  const response = await apiInstance.post<{ success: boolean; data?: TicketFieldSuggestions }>(
    '/tickets/suggest-fields',
    payload,
    requestConfig,
  );
  return response.data.data ?? {};
};

/** XOR's suggested values for a stage form, read from the ticket and its thread: field id → value. */
export const suggestStageFormFields = async (
  ticketId: string,
  formId: string,
  options?: { signal?: AbortSignal },
): Promise<Record<string, string[]>> => {
  const requestConfig = options?.signal ? { signal: options.signal } : undefined;
  const response = await apiInstance.post<{ success: boolean; data?: Record<string, string[]> }>(
    `/tickets/${ticketId}/stage-form-suggestions`,
    { formId },
    requestConfig,
  );
  return response.data.data ?? {};
};

export const generateReleaseNotes = async (
  ticketId: string,
  options?: { signal?: AbortSignal },
): Promise<ReleaseNotesApiResponse> => {
  const requestConfig = options?.signal ? { signal: options.signal } : undefined;
  const response = await apiInstance.post<ReleaseNotesApiResponse>(
    `/tickets/${ticketId}/release-notes/generate`,
    {},
    requestConfig,
  );
  const responseData: ReleaseNotesApiResponse = response.data;

  if (!responseData.success) {
    throw new Error(responseData.error || 'Failed to generate release notes');
  }

  return {
    success: responseData.success,
    ...(!responseData.success ? { error: responseData.error } : {}),
  };
};
