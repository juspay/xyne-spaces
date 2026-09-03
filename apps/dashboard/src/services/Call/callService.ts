import { apiInstance } from '../clients/apiClient';
import type { SdlcCallLink } from '@xyne/shared';
import { queryClient } from '../clients/queryClient';
import { AxiosError } from 'axios';
import { CallType, MeetingStatus, type HostControls, CalendarVisibility } from '@xyne/shared';
import { logger, Event } from '../../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface InitiateCallRequest {
  channelId?: string;
  invitedUserIds?: string[];
  callType: CallType;
  isHeadless?: boolean; // For recordings without a specific channel
  conversationId?: string; // Optional: for thread-initiated calls
  artifactMessageId?: string; // Exact slash-command artifact that owns this call
  sdlcLink?: SdlcCallLink; // Optional: SDLC entity to link the call + its conversation to
}

export interface InitiateCallResponse {
  token?: string;
  livekitUrl?: string;
  externalId?: string;
  roomLink?: string;
  channelId?: string;
  scopeType?: string | null; // Channel scope type for CallKit filtering
  /** Host admission pending; no token issued. */
  pending?: boolean;
}

export interface JoinCallRequest {
  callId: string;
}

export interface JoinCallResponse {
  token?: string;
  livekitUrl?: string;
  externalId?: string;
  roomLink?: string;
  channelId?: string;
  scopeType?: string | null; // Channel scope type for CallKit filtering
  /** Host admission pending; no token issued. */
  pending?: boolean;
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
  callUpdatesChannel?: string; // Explicit broadcast channel for post-call summaries/action items
  conversationId?: string; // Optional: for thread-initiated scheduled calls
  /** External emails to invite. */
  externalInvitees?: string[];
  /** How external invite emails should be delivered. Defaults to standalone email. */
  externalInviteDelivery?: 'standalone' | 'conversation_reply';
  /** Organizer's curated invitation body (rich-text HTML). Required when externalInvitees is non-empty. */
  invitation?: {
    bodyHtml: string;
    /** Override the call title on the rendered invitation (date/time are not overridable). */
    title?: string;
    organizerName?: string;
    organizerEmail?: string;
    orgName?: string;
    /** IANA timezone used to format start/end times in the email body. */
    timezone?: string;
  };
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
  callUpdatesChannel?: string; // Explicit broadcast channel for post-call summaries/action items
  timezone: string;
  recurrenceRule: string; // e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  startTime: string; // HH:mm 24-hour format
  endTime: string; // HH:mm 24-hour format
  startsOn: number; // epoch ms
  endsOn?: number; // epoch ms — omit for indefinite series
  externalInvitees?: string[];
  invitation?: ScheduleCallRequest['invitation'];
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
  callUpdatesChannel?: string;
  externalInvitees?: string[];
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
  callUpdatesChannel?: string;
  externalInvitees?: string[];
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

export interface HideCallRequest {
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

export type CallShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

export interface CallSharingResult {
  action: 'grant' | 'revoke';
  shares?: Array<{ id: string; target: CallShareTarget; access: string }>;
}

export class CallService {
  /**
   * Replace a call's labels. Returns the resolved Tag ids — raw text typed in the
   * picker becomes a real Tag server-side, so the response is what to store.
   */
  async updateCallLabels(callId: string, labels: string[]): Promise<string[]> {
    const response = await apiInstance.patch<{ success: true; labels: string[] }>(
      `/calls/${callId}/labels`,
      { labels },
    );
    return response.data.labels;
  }

  /**
   * Share a call with people, groups or channels, optionally with a note. Each
   * target also gets a card posted into the channel (or a DM, for a user target).
   */
  async grantCallAccess(
    callId: string,
    targets: CallShareTarget[],
    messageContent?: string,
  ): Promise<CallSharingResult> {
    const response = await apiInstance.post<{ success: true } & CallSharingResult>(
      `/calls/${callId}/sharing`,
      {
        action: 'grant',
        targets,
        ...(messageContent?.trim() ? { messageContent: messageContent.trim() } : {}),
      },
    );
    return response.data;
  }

  /** Removes a target's access and deletes the card the share posted for it. */
  async revokeCallAccess(callId: string, targets: CallShareTarget[]): Promise<CallSharingResult> {
    const response = await apiInstance.post<{ success: true } & CallSharingResult>(
      `/calls/${callId}/sharing`,
      { action: 'revoke', targets },
    );
    return response.data;
  }

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

  async hideCall(callId: string, data?: HideCallRequest): Promise<void> {
    try {
      await apiInstance.post(`/calls/${callId}/hide`, data ?? {});
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
        ...(data.artifactMessageId && { artifactMessageId: data.artifactMessageId }),
        ...(data.sdlcLink && { sdlcLink: data.sdlcLink }),
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
      logger.error(Event.API_CALL_FAILED, {
        callId: data.callIds.length === 1 ? data.callIds[0] : null,
        callIds: data.callIds,
        context: 'callService.validateRooms',
        error: error instanceof Error ? error.message : String(error),
      });
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
   * Record the host's end-of-call transcript disposition (host only).
   * Throws on failure so the caller can handle it. The discard path is
   * safety-critical: the backend defaults to KEEP if this never arrives, which
   * would persist a transcript the host explicitly discarded — so callers must
   * confirm success before ending the call rather than firing-and-forgetting.
   */
  async setTranscriptDisposition(callId: string, disposition: 'keep' | 'discard'): Promise<void> {
    try {
      await apiInstance.post(`/calls/${callId}/transcript-disposition`, { disposition });
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
   * Mirror the host's mid-call transcription on/off state into room metadata so
   * participants who join later stay in sync. Best-effort: present participants
   * already got the live data-channel toggle, so a failure here only affects
   * late-joiner sync.
   */
  async setTranscriptionState(callId: string, enabled: boolean): Promise<void> {
    try {
      await apiInstance.patch(`/calls/${callId}/transcription-state`, { enabled });
    } catch {
      // Swallow: late-joiner sync is best-effort.
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

  /** Remove a participant from the call. */
  async removeParticipant(
    callId: string,
    participantUserId: string,
  ): Promise<{ success: boolean }> {
    try {
      const response = await apiInstance.post<{ success: boolean }>(
        `/calls/${callId}/remove-participant`,
        { participantUserId },
      );

      if (!response.data.success) {
        throw new Error('Failed to remove participant');
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

  /** Set host controls for turning participant media off or allowing it again. */
  async setHostControls(callId: string, controls: Partial<HostControls>): Promise<HostControls> {
    try {
      const response = await apiInstance.patch<{
        success: boolean;
        hostControls: HostControls;
      }>(`/calls/${callId}/host-controls`, controls);

      if (!response.data.success) {
        throw new Error('Failed to update host controls');
      }

      return response.data.hostControls;
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
        ...(data.callUpdatesChannel && { callUpdatesChannel: data.callUpdatesChannel }),
        ...(data.conversationId && { conversationId: data.conversationId }),
        ...(data.externalInvitees &&
          data.externalInvitees.length > 0 && {
            externalInvitees: data.externalInvitees,
            externalInviteDelivery: data.externalInviteDelivery,
            invitation: data.invitation,
          }),
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
        ...(data.callUpdatesChannel && { callUpdatesChannel: data.callUpdatesChannel }),
        timezone: data.timezone,
        recurrenceRule: data.recurrenceRule,
        startTime: data.startTime,
        endTime: data.endTime,
        startsOn: data.startsOn,
        endsOn: data.endsOn,
        externalInvitees: data.externalInvitees,
        invitation: data.invitation,
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

  async saveWhiteboard(
    callId: string,
    payload: {
      blob: Blob;
      width: number;
      height: number;
      pageId?: string;
      pageLabel?: string;
      pageOrder?: number;
    },
  ): Promise<{
    success: boolean;
    attachmentId?: string;
    alreadyExists?: boolean;
    pageId?: string;
  }> {
    const formData = new FormData();
    const fileSuffix = payload.pageLabel ?? payload.pageId ?? 'page';
    const safeFileSuffix = fileSuffix.replace(/[^a-z0-9_-]/gi, '-');
    formData.append('file', payload.blob, `whiteboard-${callId}-${safeFileSuffix}.png`);
    formData.append('width', String(payload.width));
    formData.append('height', String(payload.height));
    if (payload.pageId) formData.append('pageId', payload.pageId);
    if (payload.pageLabel) formData.append('pageLabel', payload.pageLabel);
    if (payload.pageOrder !== undefined) formData.append('pageOrder', String(payload.pageOrder));

    try {
      const response = await apiInstance.post<{
        success: boolean;
        attachmentId?: string;
        alreadyExists?: boolean;
        pageId?: string;
      }>(`/calls/${callId}/save-whiteboard`, formData);

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

  async getOtherUserScheduledCalls(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<{
    calendarVisibility: CalendarVisibility;
    calls: { startsAt: number; endsAt: number | null; id?: string; title?: string }[];
  }> {
    const response = await apiInstance.get<{
      calendarVisibility: CalendarVisibility;
      calls: { startsAt: number; endsAt: number | null; id?: string; title?: string }[];
    }>(`/calls/user/${userId}/scheduled`, {
      params: { from: from.toISOString(), to: to.toISOString() },
    });
    return response.data;
  }
}

export const callService = new CallService();
