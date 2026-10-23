/**
 * Xyne Mirror (Slack ⇄ Spaces channel sync): a channel's sync status and requests, people's Slack
 * sign-in, the admin's request list and the Slack connection. All under the gateway's Slack routes.
 */

import { apiInstance, BASE_URL } from './apiClient';

const BASE = '/gateway/slack';

export type MirrorLinkStatus = 'ACTIVE' | 'PAUSED';
export type SyncRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface MirrorLink {
  id: string;
  workspaceId: string;
  connectionId: string;
  externalId: string;
  spacesId: string;
  status: MirrorLinkStatus;
  statusReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export type SyncRequest = {
  id: string;
  workspaceId: string;
  connectionId: string;
  externalId: string;
  externalName: string;
  spacesId: string;
  requestedBy: string;
  requestedAt: string;
  status: SyncRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
};

export type SyncRequestRow = SyncRequest & {
  spacesChannelName: string | null;
  requesterName: string | null;
  deciderName: string | null;
};

export interface ChannelSyncStatus {
  connected: boolean;
  appName: string | null;
  link: MirrorLink | null;
  externalChannel: SlackChannel | null;
  request: SyncRequest | null;
  canRequest: boolean;
  canManage: boolean;
}

export interface SlackSignInStatus {
  connected: boolean;
  connectedAt: string | null;
}

export interface SlackConnection {
  workspace: { externalWorkspaceId: string; name: string; botUserId: string; appId: string } | null;
  appName: string | null;
  description: string | null;
  urls: { events: string; userSignInRedirect: string };
}

export interface SlackConnectionInput {
  appName: string;
  description: string;
  botToken: string;
  signingSecret: string;
  clientId: string;
  clientSecret: string;
}

export interface SyncRequestFilters {
  statuses: SyncRequestStatus[];
  from?: string;
  to?: string;
  search?: string;
  limit: number;
  offset: number;
}

/** The gateway answers `{ error, code }`; anything else falls back to `fallback`. */
export function slackMirrorErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' && message ? message : fallback;
}

export async function getChannelSyncStatus(channelId: string): Promise<ChannelSyncStatus> {
  const { data } = await apiInstance.get<ChannelSyncStatus>(`${BASE}/links`, {
    params: { channelId },
  });
  return data;
}

export async function listSyncedChannelIds(): Promise<string[]> {
  const { data } = await apiInstance.get<{ channelIds: string[] }>(`${BASE}/links/synced`);
  return data.channelIds;
}

export async function listLinkableSlackChannels(channelId: string): Promise<SlackChannel[]> {
  const { data } = await apiInstance.get<{ channels: SlackChannel[] }>(`${BASE}/links/candidates`, {
    params: { channelId },
  });
  return data.channels;
}

export async function submitSyncRequest(
  spacesChannelId: string,
  externalChannelId: string,
): Promise<SyncRequest> {
  const { data } = await apiInstance.post<{ request: SyncRequest }>(`${BASE}/link-requests`, {
    spacesChannelId,
    externalChannelId,
  });
  return data.request;
}

export async function cancelSyncRequest(requestId: string): Promise<void> {
  await apiInstance.post(`${BASE}/link-requests/${requestId}/cancel`);
}

export async function pauseMirrorLink(linkId: string): Promise<void> {
  await apiInstance.post(`${BASE}/links/${linkId}/pause`);
}

export async function resumeMirrorLink(linkId: string): Promise<void> {
  await apiInstance.post(`${BASE}/links/${linkId}/resume`);
}

export async function unlinkMirrorLink(linkId: string): Promise<void> {
  await apiInstance.delete(`${BASE}/links/${linkId}`);
}

export async function listSyncRequests(
  filters: SyncRequestFilters,
): Promise<{ requests: SyncRequestRow[]; total: number }> {
  const { data } = await apiInstance.get<{ requests: SyncRequestRow[]; total: number }>(
    `${BASE}/link-requests`,
    {
      params: {
        status: filters.statuses.join(',') || undefined,
        from: filters.from,
        to: filters.to,
        search: filters.search || undefined,
        limit: filters.limit,
        offset: filters.offset,
      },
    },
  );
  return data;
}

export async function approveSyncRequest(requestId: string): Promise<void> {
  await apiInstance.post(`${BASE}/link-requests/${requestId}/approve`);
}

export async function rejectSyncRequest(requestId: string, reason: string): Promise<void> {
  await apiInstance.post(`${BASE}/link-requests/${requestId}/reject`, { reason });
}

export async function getSlackConnection(): Promise<SlackConnection> {
  const { data } = await apiInstance.get<SlackConnection>(`${BASE}/config`);
  return data;
}

export async function saveSlackConnection(input: SlackConnectionInput): Promise<void> {
  await apiInstance.put(`${BASE}/config`, input);
}

export async function removeSlackConnection(): Promise<void> {
  await apiInstance.delete(`${BASE}/config`);
}

export async function getSlackSignIn(): Promise<SlackSignInStatus> {
  const { data } = await apiInstance.get<SlackSignInStatus>(`${BASE}/user`);
  return data;
}

export async function disconnectSlackSignIn(): Promise<void> {
  await apiInstance.delete(`${BASE}/user`);
}

/** A browser navigation (cookies carry the login), like desk's "Connect your Slack". */
export function slackSignInUrl(returnTo: string, platform: 'web' | 'electron'): string {
  const params = new URLSearchParams({ returnTo, platform });
  return `${BASE_URL}${BASE}/user/connect?${params}`;
}
