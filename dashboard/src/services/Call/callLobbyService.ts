import { CallType } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

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
  response: 'REQUESTED' | 'ACCEPTED' | 'DECLINED';
}

export interface LobbyParticipant {
  id: string;
  userId: string;
  displayName: string;
  isExternal: boolean;
  response: string | null;
}

export interface CallChatMessage {
  id: string;
  callId: string;
  participantId: string;
  displayName: string;
  message: string;
  createdAt: string;
  isExternal: boolean;
}

export interface ExternalJoinResponse {
  token: string;
  serverUrl: string;
  externalId: string;
  callType: CallType;
  participantId: string;
}

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
   * Auth is via HTTP-only cookie (external) or participantId param (internal).
   */
  async sendMessage(
    externalId: string,
    message: string,
    participantId?: string,
  ): Promise<CallChatMessage> {
    const response = await apiInstance.post<CallChatMessage>(`${BASE}/${externalId}/messages`, {
      message,
      ...(participantId && { participantId }),
    });
    return response.data;
  },

  /**
   * Get chat messages for a call.
   * Auth is via HTTP-only cookie (external) or participantId param (internal).
   */
  async getMessages(
    externalId: string,
    limit?: number,
    before?: string,
    participantId?: string,
  ): Promise<CallChatMessage[]> {
    const response = await apiInstance.get<{ messages: CallChatMessage[] }>(
      `${BASE}/${externalId}/messages`,
      { params: { ...(participantId && { participantId }), limit, before } },
    );
    return response.data.messages;
  },

  /**
   * Get participant list with resolved display names (public-safe).
   * Auth is via HTTP-only cookie (external) or participantId param (internal).
   */
  async getParticipants(externalId: string, participantId?: string): Promise<LobbyParticipant[]> {
    const response = await apiInstance.get<{ participants: LobbyParticipant[] }>(
      `${BASE}/${externalId}/participants`,
      { params: { ...(participantId && { participantId }) } },
    );
    return response.data.participants;
  },
};
