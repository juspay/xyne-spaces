import { apiInstance } from './clients/apiClient';

export interface TicketDuplicateCheckRequest {
  title: string;
  description: string;
  projectId: string;
  limit?: number;
}

export interface TicketDuplicateCandidate {
  id: string;
  title: string;
  description: string;
  xyneId?: string;
  boardId?: string;
  status?: string;
  stage?: string;
  relevanceScore?: number;
  channelId?: string;
  createdAt?: string;
}

export type TicketDuplicateTier = 'likely' | 'similar';

export type TicketDuplicateRelation = 'duplicate' | 'regression' | 'related' | 'unrelated';

export interface TicketDuplicateMatch {
  id: string;
  tier: TicketDuplicateTier;
  score: number;
  relation?: TicketDuplicateRelation;
}

export interface TicketDuplicateCheckAnalysis {
  isDuplicate: boolean;
  duplicateTicketId?: string | null;
  confidence?: number;
  reason?: string;
  model?: string;
  error?: string;
  matches?: TicketDuplicateMatch[];
}

export interface TicketDuplicateCheckResponse {
  candidates?: TicketDuplicateCandidate[];
  analysis: TicketDuplicateCheckAnalysis;
}

interface TicketDuplicateApiResponse {
  success: boolean;
  data?: TicketDuplicateCheckResponse;
  error?: string;
}

export const checkTicketDuplicates = async (
  payload: TicketDuplicateCheckRequest,
  options?: { signal?: AbortSignal },
): Promise<TicketDuplicateCheckResponse> => {
  const requestConfig = options?.signal ? { signal: options.signal } : undefined;
  const response = await apiInstance.post<TicketDuplicateApiResponse>(
    '/tickets/duplicates',
    payload,
    requestConfig,
  );
  const responseData: TicketDuplicateApiResponse = response.data;

  if (!responseData.success || !responseData.data) {
    throw new Error(responseData.error || 'Duplicate check failed');
  }

  return responseData.data;
};

export interface TicketDuplicateRecheckResult {
  isDuplicate: boolean;
  linkedTicketId: string | null;
  candidateCount: number;
  confidence: number;
}

interface TicketDuplicateRecheckApiResponse {
  success: boolean;
  data?: TicketDuplicateRecheckResult;
  error?: string;
}

/** Re-runs duplicate detection for an existing ticket; a new match is linked server-side. */
export const recheckTicketDuplicates = async (
  ticketId: string,
): Promise<TicketDuplicateRecheckResult> => {
  const response = await apiInstance.post<TicketDuplicateRecheckApiResponse>(
    `/tickets/${ticketId}/duplicates/recheck`,
  );
  const responseData: TicketDuplicateRecheckApiResponse = response.data;

  if (!responseData.success || !responseData.data) {
    throw new Error(responseData.error || 'Duplicate check failed');
  }

  return responseData.data;
};
