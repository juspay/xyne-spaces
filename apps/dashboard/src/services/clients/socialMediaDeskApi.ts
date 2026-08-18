import { apiInstance } from './apiClient';

export async function startInstagramOAuth(input: {
  name: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
}): Promise<string> {
  const response = await apiInstance.post<{ authUrl: string }>(
    '/integrations/social-media/instagram/oauth/start',
    input,
  );
  return response.data.authUrl;
}

export async function startGooglePlayOAuth(input: {
  channelName: string;
  applications: Array<{
    packageName: string;
    displayName: string;
  }>;
  projectId: string;
  boardId: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
}): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    '/integrations/social-media/google-play/oauth/start',
    input,
  );
  return response.data.authorizationUrl;
}

export async function addGooglePlayApps(
  channelId: string,
  input: {
    applications: Array<{
      packageName: string;
      displayName: string;
    }>;
  },
): Promise<{ added: number }> {
  const response = await apiInstance.post<{ added: number }>(
    `/integrations/social-media/${channelId}/google-play/apps`,
    input,
  );
  return response.data;
}

export async function disconnectSocialMediaDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/disconnect`);
}

export async function fetchSocialMediaReviews(
  channelId: string,
  range?: { startDate: string; endDate: string },
): Promise<
  { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
> {
  const response = await apiInstance.post<
    { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
  >(`/integrations/social-media/${channelId}/sync`, range);
  return response.data;
}

export async function disconnectGooglePlayApp(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/google-play/apps/${sourceId}/disconnect`,
  );
}

export async function reconnectGooglePlayApp(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/google-play/apps/${sourceId}/reconnect`,
  );
}

export async function reconnectSocialMediaDesk(
  channelId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/reconnect`,
    { platform },
  );
  return response.data.authorizationUrl;
}

export interface AppStoreCredentialsInput {
  keyId: string;
  privateKey: string;
}

/** App Store Connect authenticates with a signed JWT, so connecting is one POST — no OAuth. */
export async function connectAppStoreDesk(
  input: AppStoreCredentialsInput & {
    channelName: string;
    applications: Array<{ bundleId: string }>;
    projectId: string;
    boardId: string;
    assigneeUserGroupId?: string;
    visibility: 'PUBLIC' | 'PRIVATE';
  },
): Promise<string> {
  const response = await apiInstance.post<{ channelId: string }>(
    '/integrations/social-media/app-store/connect',
    input,
  );
  return response.data.channelId;
}

export async function addAppStoreApps(
  channelId: string,
  input: { applications: Array<{ bundleId: string }> },
): Promise<{ added: number }> {
  const response = await apiInstance.post<{ added: number }>(
    `/integrations/social-media/${channelId}/app-store/apps`,
    input,
  );
  return response.data;
}

export async function setAppStoreAppConnection(
  channelId: string,
  sourceId: string,
  connected: boolean,
): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/app-store/apps/${sourceId}/${
      connected ? 'reconnect' : 'disconnect'
    }`,
  );
}

/** Initiates Instagram Business OAuth — returns `authUrl` for redirect. */
export async function startInstagramOAuth(input: {
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
}): Promise<string> {
  const response = await apiInstance.post<{ authUrl: string }>(
    '/integrations/social-media/instagram/oauth/start',
    { name: input.channelName, ...input },
  );
  return response.data.authUrl;
}

/** Apple keys are rotated by pasting a new .p8, not by re-running a consent redirect. */
export async function rotateAppStoreCredentials(
  channelId: string,
  input: AppStoreCredentialsInput,
): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/app-store/credentials`, input);
}
