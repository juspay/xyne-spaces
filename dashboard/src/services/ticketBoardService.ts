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
