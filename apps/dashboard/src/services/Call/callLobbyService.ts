import { CallType, InvitationResponse } from '@xyne/shared';
import type { CallChatMessage } from '@xyne/shared';
import axios from 'axios';
import { apiInstance, BASE_URL } from '../clients/apiClient';

export interface CallInfo {
  title: string | null;
  callType: string;
  status: string;
  /** Present when the user has a valid session cookie — skip the lobby form */
  hasSession?: boolean;
}

export interface RequestToJoinResponse {
  participantId?: string;
  skipApproval?: boolean;
}

export interface LobbyStatusResponse {
  response:
    | InvitationResponse.REQUESTED
    | InvitationResponse.ACCEPTED
    | InvitationResponse.DECLINED;
}

export interface LobbyParticipant {
  id: string;
  userId: string;
  displayName: string;
  isExternal: boolean;
  response: string | null;
}

export interface CallLobbyActiveRecording {
  recordingId: string;
  startedBy: string | null;
  startedByName?: string | null;
  startedAt: number;
  recordingType: string;
}

export interface CallLobbyRecordingStateResponse {
  activeRecording: CallLobbyActiveRecording | null;
}

// Re-export shared type for backward compatibility
export type { CallChatMessage } from '@xyne/shared';

export interface ExternalJoinResponse {
  token: string;
  serverUrl: string;
  externalId: string;
  callType: CallType;
  participantId: string;
}

export type InternalCallRouteResolution =
  | { result: 'internal'; workspaceId: string }
  | { result: 'external' };

const BASE = '/call-lobby';

export const callLobbyService = {
  /**
   * Fetch public call info for the pre-join lobby page.
   * Returns null if the call has ended, throws on not-found.
   */
  async getCallInfo(externalId: string): Promise<CallInfo | 'ended' | 'not_found'> {
    try {
      const response = await apiInstance.get<CallInfo & { status?: string }>(
        `${BASE}/${externalId}`,
      );
      const data = response.data;
      if (data.status === 'ended') return 'ended';
      return data as CallInfo;
    } catch (err: unknown) {
      const e = err as { status?: number; response?: { status?: number } };
      if (e?.status === 404 || e?.response?.status === 404) return 'not_found';
      throw err;
    }
  },

  /**
   * Resolve against the auth cookie for the call's own workspace. This only
   * chooses internal dashboard vs external lobby; /calls/join still enforces
   * the call-specific host/invitee/channel membership rules.
   */
  async resolveInternalRoute(externalId: string): Promise<InternalCallRouteResolution> {
    // Keep this public probe isolated from the dashboard client's global 401
    // redirect behavior. Expected misses are normal external-lobby traffic.
    const response = await axios.post<InternalCallRouteResolution>(
      `${BASE_URL}${BASE}/${encodeURIComponent(externalId)}/resolve-internal`,
      undefined,
      { withCredentials: true },
    );
    return response.data;
  },

  /**
   * Request to join a call as an external user.
   * Cookie is set by the backend on success.
   */
  async requestToJoin(externalId: string, displayName: string): Promise<RequestToJoinResponse> {
    const response = await apiInstance.post<RequestToJoinResponse>(
      `${BASE}/${externalId}/request`,
      { displayName },
    );
    return response.data;
  },

  /**
   * Poll the lobby admission status. Identity comes from session cookie.
   */
  async getLobbyStatus(externalId: string): Promise<LobbyStatusResponse> {
    const response = await apiInstance.get<LobbyStatusResponse>(`${BASE}/${externalId}/status`);
    return response.data;
  },

  /**
   * Join once admitted — returns a LiveKit token and connection details.
   * Identity comes from session cookie.
   */
  async externalJoin(externalId: string): Promise<ExternalJoinResponse> {
    const response = await apiInstance.post<ExternalJoinResponse>(`${BASE}/${externalId}/join`);
    return response.data;
  },

  /**
   * Rejoin a call — restores participant status. Identity from cookie.
   */
  async rejoinLobby(externalId: string): Promise<RequestToJoinResponse> {
    const response = await apiInstance.post<RequestToJoinResponse>(`${BASE}/${externalId}/rejoin`);
    return response.data;
  },

  /**
   * Send a chat message in a call.
   * Auth is via HTTP-only cookie (external users only).
   * Internal users should use callChatService instead.
   */
  async sendMessage(externalId: string, message: string): Promise<CallChatMessage> {
    const response = await apiInstance.post<CallChatMessage>(`${BASE}/${externalId}/messages`, {
      message,
    });
    return response.data;
  },

  /**
   * Get chat messages for a call.
   * Auth is via HTTP-only cookie (external users only).
   * Internal users should use callChatService instead.
   */
  async getMessages(
    externalId: string,
    limit?: number,
    before?: string,
  ): Promise<CallChatMessage[]> {
    const response = await apiInstance.get<{ messages: CallChatMessage[] }>(
      `${BASE}/${externalId}/messages`,
      { params: { limit, before } },
    );
    return response.data.messages;
  },

  /**
   * Get participant list with resolved display names (public-safe).
   * Auth is via HTTP-only cookie (external users only).
   * Internal users should use callChatService instead.
   */
  async getParticipants(externalId: string): Promise<LobbyParticipant[]> {
    const response = await apiInstance.get<{ participants: LobbyParticipant[] }>(
      `${BASE}/${externalId}/participants`,
    );
    return response.data.participants;
  },

  /**
   * Get active recording state for an admitted external participant.
   * Auth is via HTTP-only cookie.
   */
  async getRecordingState(externalId: string): Promise<CallLobbyRecordingStateResponse> {
    const response = await apiInstance.get<CallLobbyRecordingStateResponse>(
      `${BASE}/${externalId}/recording-state`,
    );
    return response.data;
  },
};
