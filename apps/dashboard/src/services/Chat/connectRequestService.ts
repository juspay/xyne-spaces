import { apiInstance } from '../clients/apiClient';

/** Slack-Connect invite/approval (connect_request) — REST client (the table is non_zero, not Zero-synced). */

export interface ConnectRequestDto {
  id: string;
  entityId: string;
  entityType: string;
  hostWorkspaceId: string;
  guestWorkspaceId: string | null;
  inviteEmail: string;
  status: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ConnectInviteVerifyInfo {
  inviteEmail: string;
  status: string;
  channelName: string | null;
  channelVisibility: string | null;
  hostWorkspaceName: string | null;
}

export const connectRequestService = {
  // ── channel connect toggle ──
  async enableConnect(channelId: string): Promise<void> {
    await apiInstance.post(`/connect-requests/channels/${channelId}/enable-connect`);
  },
  async disableConnect(channelId: string): Promise<void> {
    await apiInstance.post(`/connect-requests/channels/${channelId}/disable-connect`);
  },
  async canDisableConnect(channelId: string): Promise<boolean> {
    const res = await apiInstance.get<{ canDisable: boolean }>(
      `/connect-requests/channels/${channelId}/can-disable-connect`,
    );
    return res.data.canDisable;
  },

  // ── invite + per-channel list ──
  async invite(channelId: string, email: string): Promise<ConnectRequestDto> {
    const res = await apiInstance.post<{ request: ConnectRequestDto }>('/connect-requests', {
      channelId,
      email,
    });
    return res.data.request;
  },
  async listForChannel(channelId: string): Promise<ConnectRequestDto[]> {
    const res = await apiInstance.get<{ requests: ConnectRequestDto[] }>(
      `/connect-requests/channel/${channelId}`,
    );
    return res.data.requests;
  },

  // ── admin inboxes ──
  async outbox(): Promise<ConnectRequestDto[]> {
    const res = await apiInstance.get<{ requests: ConnectRequestDto[] }>(
      '/connect-requests/outbox',
    );
    return res.data.requests;
  },
  async inbox(): Promise<ConnectRequestDto[]> {
    const res = await apiInstance.get<{ requests: ConnectRequestDto[] }>('/connect-requests/inbox');
    return res.data.requests;
  },

  // ── gates ──
  async hostApprove(id: string): Promise<{ request: ConnectRequestDto; inviteLink?: string }> {
    const res = await apiInstance.post<{ request: ConnectRequestDto; inviteLink?: string }>(
      `/connect-requests/${id}/host-approve`,
    );
    return res.data;
  },
  async guestApprove(id: string): Promise<ConnectRequestDto> {
    const res = await apiInstance.post<{ request: ConnectRequestDto }>(
      `/connect-requests/${id}/guest-approve`,
    );
    return res.data.request;
  },
  async reject(id: string): Promise<ConnectRequestDto> {
    const res = await apiInstance.post<{ request: ConnectRequestDto }>(
      `/connect-requests/${id}/reject`,
    );
    return res.data.request;
  },

  // ── guest accept page ──
  async verify(token: string): Promise<ConnectInviteVerifyInfo> {
    const res = await apiInstance.get<ConnectInviteVerifyInfo>(`/connect-requests/${token}/verify`);
    return res.data;
  },
  async accept(
    token: string,
    payload: { guestWorkspaceId: string; channelName?: string; visibility?: 'PUBLIC' | 'PRIVATE' },
  ): Promise<ConnectRequestDto> {
    const res = await apiInstance.post<{ request: ConnectRequestDto }>(
      `/connect-requests/${token}/accept`,
      payload,
    );
    return res.data.request;
  },
};
