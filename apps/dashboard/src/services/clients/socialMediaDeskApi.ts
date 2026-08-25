import { apiInstance } from './apiClient';

export async function startInstagramOAuth(input: {
  name: string;
  projectId: string;
  boardId: string;
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

export async function fetchGooglePlayReviews(
  channelId: string,
): Promise<
  { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
> {
  const response = await apiInstance.post<
    { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
  >(`/integrations/social-media/${channelId}/sync`);
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

export async function disconnectInstagramDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/instagram/disconnect`);
}

export async function reconnectInstagramDesk(
  channelId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authUrl: string }>(
    `/integrations/social-media/${channelId}/instagram/reconnect`,
    { platform },
  );
  return response.data.authUrl;
}
