import { apiInstance } from '../clients/apiClient';
import { queryClient } from '../clients/queryClient';
import { AxiosError } from 'axios';
import { CallType } from '@xyne/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface InitiateCallRequest {
  channelId?: string;
  invitedUserIds?: string[];
  callType: CallType;
  isHeadless?: boolean; // For recordings without a specific channel
}

export interface InitiateCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink: string;
  channelId: string;
}

export interface JoinCallRequest {
  callId: string;
}

export interface JoinCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink: string;
}

export interface ValidateRoomsRequest {
  callIds: string[];
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  message?: string;
}

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as ApiErrorResponse).error === 'string'
  );
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class CallService {
  /**
   * Initiate a new call
   * Creates a LiveKit room and returns call details
   */
  async initiateCall(data: InitiateCallRequest): Promise<InitiateCallResponse> {
    try {
      const response = await apiInstance.post<InitiateCallResponse>('/calls/initiate', {
        channelId: data.channelId,
        invitedUserIds: data.invitedUserIds,
        callType: data.callType,
        isHeadless: data.isHeadless,
      });

      return response.data;
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Join an existing call
   * Generates LiveKit token for the user to join the call
   */
  async joinCall(data: JoinCallRequest): Promise<JoinCallResponse> {
    try {
      const response = await apiInstance.post<JoinCallResponse>('/calls/join', {
        callId: data.callId,
      });

      return response.data;
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Validate active calls against LiveKit room state
   * Backend will mark invalid calls as ENDED (no response needed)
   */
  async validateRooms(data: ValidateRoomsRequest): Promise<void> {
    try {
      await apiInstance.post('/calls/validate-rooms', {
        callIds: data.callIds,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to validate calls:', error);
    }
  }

  /**
   * End call for everyone (host only)
   * Removes the participants from the LiveKit room and marks the call as ENDED in the backend
   */
  async endCallForAll(callId: string): Promise<void> {
    try {
      const response = await apiInstance.post<{ success: boolean }>(`/calls/${callId}/end-for-all`);

      if (!response.data.success) {
        throw new Error('Failed to end call for everyone');
      }
    } catch (error) {
      // Handle Axios errors with proper typing
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;

        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }

      // Re-throw unknown errors
      throw error;
    }
  }

  /**
   * Download call transcript
   * Returns the transcript content as text and content-type header
   * Uses React Query caching (10 min staleTime) to avoid redundant downloads
   */
  async downloadTranscript(callId: string): Promise<{ data: string; contentType?: string }> {
    const url = `/calls/${callId}/download-transcript`;
    const queryKey = ['transcript', callId];

    return queryClient.fetchQuery<{ data: string; contentType?: string }>({
      queryKey,
      queryFn: async ({ signal }) => {
        try {
          const response = await apiInstance.get<string>(url, { signal });
          const contentType = response.headers?.['content-type'] as string | undefined;
          return {
            data: response.data,
            ...(contentType !== undefined && { contentType }),
          };
        } catch (error) {
          if (error instanceof AxiosError && error.response?.data) {
            const errorData = error.response.data as unknown;
            if (isApiErrorResponse(errorData)) {
              throw new ApiError(
                errorData.error,
                error.response.status,
                errorData.code ?? 'UNKNOWN_ERROR',
              );
            }
          }
          throw error;
        }
      },
      staleTime: 10 * 60 * 1000,
    });
  }

  /**
   * Create a Pulse actionable item for a specific call.
   * The backend proxies this to Pulse S2S — credentials never reach the browser.
   */
  async createPulseActionable(
    callId: string,
    payload: {
      title: string;
      description?: string;
      assignee?: string;
      merchantName?: string;
      orgId?: string;
      merchantId?: string | null;
      productId?: string | null;
    },
  ): Promise<{ success: boolean }> {
    try {
      const response = await apiInstance.post<{ success: boolean }>(
        `/calls/${callId}/pulse-actionable`,
        payload,
      );
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.data) {
        const errorData = error.response.data as unknown;
        if (isApiErrorResponse(errorData)) {
          throw new ApiError(
            errorData.error,
            error.response.status,
            errorData.code ?? 'UNKNOWN_ERROR',
          );
        }
      }
      throw error;
    }
  }
}

export const callService = new CallService();
