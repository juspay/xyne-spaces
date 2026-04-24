import { apiInstance } from '../clients/apiClient';
import { queryClient } from '../clients/queryClient';
import { AxiosError } from 'axios';
import { CallType, MeetingStatus } from '@xyne/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface InitiateCallRequest {
  channelId?: string;
  invitedUserIds?: string[];
  callType: CallType;
  isHeadless?: boolean; // For recordings without a specific channel
  conversationId?: string; // Optional: for thread-initiated calls
}

export interface InitiateCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink: string;
  channelId: string;
  scopeType?: string | null; // Channel scope type for CallKit filtering
}

export interface JoinCallRequest {
  callId: string;
}

export interface JoinCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink: string;
  channelId?: string;
  scopeType?: string | null; // Channel scope type for CallKit filtering
}

export interface ValidateRoomsRequest {
  callIds: string[];
}

export interface ScheduleCallRequest {
  title: string;
  startsAt: number;
  endsAt: number;
  channelId?: string;
  targetUserIds?: string[];
  conversationId?: string; // Optional: for thread-initiated scheduled calls
}

export interface ScheduleCallResponse {
  success: boolean;
  callId: string;
  externalId: string;
  channelId: string;
}

export interface CreateRecurringSeriesRequest {
  title: string;
  description?: string;
  channelId?: string;
  targetUserIds?: string[];
  timezone: string;
  recurrenceRule: string; // e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  startTime: string; // HH:mm 24-hour format
  endTime: string; // HH:mm 24-hour format
  startsOn: number; // epoch ms
  endsOn?: number; // epoch ms — omit for indefinite series
}

export interface CreateRecurringSeriesResponse {
  success: boolean;
  seriesId: string;
  channelId: string;
}

export interface UpdateScheduleCallRequest {
  title?: string;
  startsAt?: number; // epoch ms
  endsAt?: number; // epoch ms
  targetUserIds?: string[];
  channelId?: string;
}

export interface UpdateRecurringSeriesRequest {
  title?: string;
  recurrenceRule?: string;
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  startsOn?: number; // epoch ms — new UTC dtstart when startTime changes
  endsOn?: number; // epoch ms
  timezone?: string;
  targetUserIds?: string[];
  channelId?: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  message?: string;
}

export interface UpdateRsvpRequest {
  status: MeetingStatus;
  isSeries?: boolean;
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
  async updateMeetingStatus(callId: string, data: UpdateRsvpRequest): Promise<void> {
    try {
      await apiInstance.post(`/calls/${callId}/rsvp`, data);
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
        ...(data.conversationId && { conversationId: data.conversationId }),
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
   * Join an existing call (regular or scheduled)
   * Generates LiveKit token for the user to join the call
   * For scheduled calls, backend will create the room if it doesn't exist yet
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
   * Mute all participants (host only)
   * Mutes the audio tracks of all participants except the host
   */
  async muteAllParticipants(callId: string): Promise<{ mutedCount: number }> {
    try {
      const response = await apiInstance.post<{ success: boolean; mutedCount: number }>(
        `/calls/${callId}/mute-all`,
      );

      if (!response.data.success) {
        throw new Error('Failed to mute all participants');
      }

      return { mutedCount: response.data.mutedCount };
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

  /**
   * Mute a specific participant (host only)
   * Mutes the audio tracks of a specific participant
   */
  async muteParticipant(callId: string, participantUserId: string): Promise<{ success: boolean }> {
    try {
      const response = await apiInstance.post<{ success: boolean }>(
        `/calls/${callId}/mute-participant`,
        { participantUserId },
      );

      if (!response.data.success) {
        throw new Error('Failed to mute participant');
      }

      return { success: true };
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

  /**
   * Schedule a call for a future time
   * Creates a scheduled call record and finds/creates DM channel if needed
   */
  async scheduleCall(data: ScheduleCallRequest): Promise<ScheduleCallResponse> {
    try {
      const response = await apiInstance.post<ScheduleCallResponse>('/calls/schedule', {
        title: data.title,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        channelId: data.channelId,
        targetUserIds: data.targetUserIds,
        ...(data.conversationId && { conversationId: data.conversationId }),
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
   * Create a recurring call series
   * Generates instances for the next 12 weeks and schedules reminder/auto-end jobs per instance
   */
  async createRecurringSeries(
    data: CreateRecurringSeriesRequest,
  ): Promise<CreateRecurringSeriesResponse> {
    try {
      const response = await apiInstance.post<CreateRecurringSeriesResponse>('/calls/series', {
        title: data.title,
        description: data.description,
        channelId: data.channelId,
        targetUserIds: data.targetUserIds,
        timezone: data.timezone,
        recurrenceRule: data.recurrenceRule,
        startTime: data.startTime,
        endTime: data.endTime,
        startsOn: data.startsOn,
        endsOn: data.endsOn,
      });

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
   * Cancel a single scheduled call instance.
   * Marks the instance as CANCELLED and triggers buffer replenishment for recurring series.
   */
  async cancelScheduledCall(callId: string): Promise<void> {
    try {
      await apiInstance.delete(`/calls/${callId}`);
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

  /**
   * Cancel an entire recurring call series.
   * Marks all future instances as CANCELLED and removes their Bull jobs.
   */
  async cancelRecurringSeries(seriesId: string): Promise<void> {
    try {
      await apiInstance.delete(`/calls/series/${seriesId}`);
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

  /**
   * Update a single scheduled call instance (title, time, participants).
   */
  async updateScheduledCall(callId: string, data: UpdateScheduleCallRequest): Promise<void> {
    try {
      await apiInstance.patch(`/calls/${callId}`, data);
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

  /**
   * Update a recurring call series (title, recurrence rule, times, end date, participants).
   */
  async updateRecurringSeries(seriesId: string, data: UpdateRecurringSeriesRequest): Promise<void> {
    try {
      await apiInstance.patch(`/calls/series/${seriesId}`, data);
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

  /**
   * Fetch the list of Pulse organisations.
   * Used to let users reassign a merchant in the Pulse actionables UI.
   */
  async fetchPulseOrgs(): Promise<
    Array<{ id: string; name: string; orgId: string; merchantIds: string[] }>
  > {
    try {
      const response = await apiInstance.get<{
        success: boolean;
        orgs: Array<{ id: string; name: string; orgId: string; merchantIds: string[] }>;
      }>('/calls/pulse-orgs');
      return response.data.orgs;
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
