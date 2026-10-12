import { getAuthToken } from '../../contexts/AuthContext';
import { CallType, MeetingStatus } from '@xyne/shared';
import { apiGetText, apiPost, apiRequest, isMtlsRequestError } from '../apiClient';
import { PUBLIC_DEEP_LINK_ORIGIN } from '../../config';
import { canonicalizePublicDeepLink } from '../../utils/publicDeepLink';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// ============================================================================
// TYPES
// ============================================================================

export interface InitiateCallRequest {
  channelId?: string;
  invitedUserIds?: string[];
  callType: CallType;
  isHeadless?: boolean;
  conversationId?: string;
}

export interface InitiateCallResponse {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink: string;
  channelId: string;
  scopeType?: string | null;
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
  scopeType?: string | null;
}

export interface ValidateRoomsRequest {
  callIds: string[];
}

export type ScheduleCallRequest = {
  title: string;
  startsAt: number;
  endsAt: number;
  channelId?: string;
  targetUserIds?: string[];
  callUpdatesChannel?: string;
  conversationId?: string;
  externalInvitees?: string[];
  externalInviteDelivery?: 'standalone' | 'conversation_reply';
  invitation?: CallInvitation;
};

export type CallInvitation = {
  bodyHtml: string;
  title?: string;
  organizerName?: string;
  organizerEmail?: string;
  orgName?: string;
  /** IANA timezone used to format start/end times in the email. */
  timezone?: string;
};

export interface ScheduleCallResponse {
  success: boolean;
  callId: string;
  externalId: string;
  channelId: string;
}

export type CreateRecurringSeriesRequest = {
  title: string;
  description?: string;
  channelId?: string;
  targetUserIds?: string[];
  callUpdatesChannel?: string;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR". */
  recurrenceRule: string;
  /** HH:mm, 24-hour, local to the first occurrence. */
  startTime: string;
  endTime: string;
  /** Epoch ms of the first occurrence (the RRULE dtstart). */
  startsOn: number;
  /** Epoch ms; omit for an indefinite series. */
  endsOn?: number;
  externalInvitees?: string[];
  invitation?: CallInvitation;
};

export interface CreateRecurringSeriesResponse {
  success: boolean;
  seriesId: string;
  channelId: string;
}

export type UpdateScheduleCallRequest = {
  title?: string;
  startsAt?: number;
  endsAt?: number;
  targetUserIds?: string[];
  channelId?: string;
  callUpdatesChannel?: string;
  externalInvitees?: string[];
};

export type UpdateRecurringSeriesRequest = {
  title?: string;
  recurrenceRule?: string;
  startTime?: string;
  endTime?: string;
  startsOn?: number;
  endsOn?: number;
  timezone?: string;
  targetUserIds?: string[];
  channelId?: string;
  callUpdatesChannel?: string;
  externalInvitees?: string[];
};

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
// HELPER FUNCTIONS
// ============================================================================

interface CallApiCredentialsResponse {
  success: boolean;
  token?: string;
  livekitUrl?: string;
  externalId?: string;
  roomLink?: string;
  channelId?: string;
  scopeType?: string | null;
  error?: string;
}

function extractCredentials(
  response: CallApiCredentialsResponse,
  errorFallback: string,
): {
  token: string;
  livekitUrl: string;
  externalId: string;
  roomLink?: string;
  channelId?: string;
  scopeType?: string | null;
} {
  if (!response.success) {
    throw new ApiError(response.error || errorFallback, 400, 'API_ERROR');
  }
  if (!response.token || !response.livekitUrl || !response.externalId) {
    throw new ApiError(errorFallback, 500, 'INVALID_RESPONSE');
  }
  return {
    token: response.token,
    livekitUrl: response.livekitUrl,
    externalId: response.externalId,
    ...(response.roomLink !== undefined
      ? { roomLink: canonicalizePublicDeepLink(response.roomLink, PUBLIC_DEEP_LINK_ORIGIN) }
      : {}),
    ...(response.channelId !== undefined ? { channelId: response.channelId } : {}),
    ...(response.scopeType !== undefined ? { scopeType: response.scopeType } : {}),
  };
}

/** The server's `error` text, unless it is a stringified Zod issue array (starts with `[`). */
function readServerMessage(responseBody: string): string | null {
  try {
    const { error } = JSON.parse(responseBody) as { error?: unknown };
    return typeof error === 'string' && !error.trimStart().startsWith('[') ? error : null;
  } catch {
    return null;
  }
}

/**
 * Run a schedule or cancel request and surface the server's reason as an ApiError. The backend
 * answers some validation failures with an unreadable Zod array or a bare 500, so those fall back
 * to `fallback`.
 */
async function withApiError<T>(fallback: string, run: (token: string) => Promise<T>): Promise<T> {
  const authToken = await getAuthToken();
  if (!authToken) {
    throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
  }
  try {
    return await run(authToken);
  } catch (error) {
    if (!isMtlsRequestError(error)) throw error;
    throw new ApiError(
      readServerMessage(error.responseBody) ?? fallback,
      error.statusCode,
      'UNKNOWN_ERROR',
    );
  }
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

class CallServiceWrapper {
  /**
   * Initiate a new call
   * Creates a LiveKit room and returns call details
   */
  async initiateCall(data: InitiateCallRequest): Promise<InitiateCallResponse> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const payload: { [key: string]: JsonValue } = {
      callType: data.callType,
    };

    // Only add optional properties if they have values
    if (data.channelId !== undefined) {
      payload['channelId'] = data.channelId;
    }
    if (data.invitedUserIds !== undefined && data.invitedUserIds.length > 0) {
      payload['invitedUserIds'] = data.invitedUserIds;
    }
    if (data.isHeadless !== undefined) {
      payload['isHeadless'] = data.isHeadless;
    }
    if (data.conversationId !== undefined) {
      payload['conversationId'] = data.conversationId;
    }

    const response = await apiPost<CallApiCredentialsResponse>('/calls/initiate', payload, {
      token: authToken,
    });
    const creds = extractCredentials(response, 'Failed to initiate call');
    return {
      token: creds.token,
      livekitUrl: creds.livekitUrl,
      externalId: creds.externalId,
      roomLink: creds.roomLink ?? '',
      channelId: creds.channelId ?? '',
      ...(creds.scopeType !== undefined ? { scopeType: creds.scopeType } : {}),
    };
  }

  /**
   * Join an existing call (regular or scheduled)
   * Generates LiveKit token for the user to join the call
   */
  async joinCall(data: JoinCallRequest): Promise<JoinCallResponse> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const response = await apiPost<CallApiCredentialsResponse>(
      '/calls/join',
      { callId: data.callId },
      { token: authToken },
    );
    const creds = extractCredentials(response, 'Failed to join call');
    return {
      token: creds.token,
      livekitUrl: creds.livekitUrl,
      externalId: creds.externalId,
      roomLink: creds.roomLink ?? '',
      ...(creds.channelId !== undefined ? { channelId: creds.channelId } : {}),
      ...(creds.scopeType !== undefined ? { scopeType: creds.scopeType } : {}),
    };
  }

  /**
   * Validate active calls against LiveKit room state
   * Backend will mark invalid calls as ENDED (no response needed)
   */
  async validateRooms(_data: ValidateRoomsRequest): Promise<void> {
    // Not implemented in Lotus base CallService - silently pass
    // This is used by roomMachine for state sync
  }

  /**
   * Invite users to an active call
   * Creates call_participants records and sends notifications
   */
  async inviteUsers(callId: string, userIds: string[]): Promise<void> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const response = await apiPost<{ success: boolean; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/invite`,
      { userIds },
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to invite users', 400, 'API_ERROR');
    }
  }

  /**
   * Decline an incoming call
   * Marks the call participant record as DECLINED
   */
  async declineCall(callId: string): Promise<void> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const response = await apiPost<{ success: boolean; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/decline`,
      {},
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to decline call', 400, 'API_ERROR');
    }
  }

  /**
   * Tell the caller this device has the incoming call (their "Calling…" becomes "Ringing…").
   * The backend only ever raises the status and ignores it once you've answered or declined.
   */
  async reportRingStatus(callId: string, ringStatus: 'RINGING' | 'BUSY'): Promise<void> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const response = await apiPost<{ success: boolean; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/ring-status`,
      { ringStatus },
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to report ring status', 400, 'API_ERROR');
    }
  }

  /**
   * End call for everyone (host only)
   * Removes the participants from the LiveKit room and marks the call as ENDED
   */
  async endCallForAll(callId: string): Promise<void> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }

    const response = await apiPost<{ success: boolean; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/end-for-all`,
      {},
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to end call', 400, 'API_ERROR');
    }
  }

  /**
   * Mute all participants (host only)
   */
  async muteAllParticipants(callId: string): Promise<{ mutedCount: number }> {
    const authToken = await getAuthToken();
    if (!authToken) throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    const response = await apiPost<{ success: boolean; mutedCount: number; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/mute-all`,
      {},
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to mute all participants', 400, 'API_ERROR');
    }
    return { mutedCount: response.mutedCount ?? 0 };
  }

  /**
   * Mute a specific participant (host only)
   */
  async muteParticipant(callId: string, participantUserId: string): Promise<{ success: boolean }> {
    const authToken = await getAuthToken();
    if (!authToken) throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    const response = await apiPost<{ success: boolean; error?: string }>(
      `/calls/${encodeURIComponent(callId)}/mute-participant`,
      { participantUserId },
      { token: authToken },
    );
    if (!response.success) {
      throw new ApiError(response.error || 'Failed to mute participant', 400, 'API_ERROR');
    }
    return { success: true };
  }

  /**
   * Schedule a call for a future time (POST /calls/schedule)
   */
  async scheduleCall(data: ScheduleCallRequest): Promise<ScheduleCallResponse> {
    return withApiError('Failed to schedule call', token =>
      apiPost<ScheduleCallResponse>('/calls/schedule', data, { token }),
    );
  }

  /**
   * Create a recurring call series (POST /calls/series)
   */
  async createRecurringSeries(
    data: CreateRecurringSeriesRequest,
  ): Promise<CreateRecurringSeriesResponse> {
    return withApiError('Failed to create recurring series', token =>
      apiPost<CreateRecurringSeriesResponse>('/calls/series', data, { token }),
    );
  }

  /**
   * Download call transcript
   * Returns the transcript content as text
   */
  async downloadTranscript(callId: string): Promise<{ data: string; contentType?: string }> {
    const authToken = await getAuthToken();
    if (!authToken) {
      throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
    }
    return apiGetText(`/calls/${encodeURIComponent(callId)}/download-transcript`, {
      token: authToken,
    });
  }

  /**
   * Cancel a single scheduled call instance
   * Marks the instance as CANCELLED (DELETE /calls/:callId)
   */
  async cancelScheduledCall(callId: string): Promise<void> {
    await withApiError('Failed to cancel call', token =>
      apiRequest<{ success: boolean; error?: string }>(`/calls/${encodeURIComponent(callId)}`, {
        method: 'DELETE',
        token,
      }),
    );
  }

  /**
   * Cancel an entire recurring call series
   * Marks all future instances as CANCELLED (DELETE /calls/series/:seriesId)
   */
  async cancelRecurringSeries(seriesId: string): Promise<void> {
    await withApiError('Failed to cancel series', token =>
      apiRequest<{ success: boolean; error?: string }>(
        `/calls/series/${encodeURIComponent(seriesId)}`,
        { method: 'DELETE', token },
      ),
    );
  }

  /**
   * Update a single scheduled call instance (PATCH /calls/:callId)
   */
  async updateScheduledCall(callId: string, data: UpdateScheduleCallRequest): Promise<void> {
    await withApiError('Failed to update call', token =>
      apiRequest<{ success: boolean; error?: string }>(`/calls/${encodeURIComponent(callId)}`, {
        method: 'PATCH',
        body: data,
        token,
      }),
    );
  }

  /**
   * Update a recurring call series (PATCH /calls/series/:seriesId)
   */
  async updateRecurringSeries(seriesId: string, data: UpdateRecurringSeriesRequest): Promise<void> {
    await withApiError('Failed to update series', token =>
      apiRequest<{ success: boolean; error?: string }>(
        `/calls/series/${encodeURIComponent(seriesId)}`,
        { method: 'PATCH', body: data, token },
      ),
    );
  }

  /**
   * Update meeting RSVP status
   * Not implemented in base service - placeholder
   */
  async updateMeetingStatus(_callId: string, _data: UpdateRsvpRequest): Promise<void> {
    throw new ApiError('Meeting RSVP not yet supported', 501, 'NOT_IMPLEMENTED');
  }

  /**
   * Create a Pulse actionable item for a call
   * Not implemented in base service - placeholder
   */
  async createPulseActionable(
    _callId: string,
    _payload: {
      title: string;
      description?: string;
      assignee?: string;
      merchantName?: string;
      orgId?: string;
      merchantId?: string | null;
      productId?: string | null;
    },
  ): Promise<{ success: boolean }> {
    throw new ApiError('Pulse actionables not yet supported', 501, 'NOT_IMPLEMENTED');
  }

  /**
   * Fetch the list of Pulse organisations
   * Not implemented in base service - placeholder
   */
  async fetchPulseOrgs(): Promise<
    Array<{ id: string; name: string; orgId: string; merchantIds: string[] }>
  > {
    throw new ApiError('Pulse orgs not yet supported', 501, 'NOT_IMPLEMENTED');
  }
}

export const callService = new CallServiceWrapper();
