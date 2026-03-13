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
