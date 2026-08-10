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

export async function disconnectSocialMediaDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/disconnect`);
}

export async function reconnectSocialMediaDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/reconnect`);
}
