import { apiInstance } from './apiClient';

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
