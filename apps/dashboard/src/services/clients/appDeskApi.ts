import { apiInstance } from './apiClient';

export interface ConnectedChannelApp {
  sourceId: string;
  installedAppId: string;
  appName: string;
  isActive: boolean;
  createdAt: string;
}

export async function listChannelApps(channelId: string): Promise<ConnectedChannelApp[]> {
  const res = await apiInstance.get<{ success: true; apps: ConnectedChannelApp[] }>(
    `/integrations/app-desk/channels/${channelId}/apps`,
  );
  return res.data.apps;
}

export async function connectChannelApp(channelId: string, installedAppId: string): Promise<void> {
  await apiInstance.post<{ success: true }>(`/integrations/app-desk/channels/${channelId}/apps`, {
    installedAppId,
  });
}

export async function disconnectChannelApp(
  channelId: string,
  installedAppId: string,
): Promise<void> {
  await apiInstance.delete<{ success: true }>(
    `/integrations/app-desk/channels/${channelId}/apps/${installedAppId}`,
  );
}

export interface AppDeskEligibleApp {
  installedAppId: string;
  appId: string;
  name: string;
  description: string | null;
  deskCount: number;
}

export async function listAppDeskEligibleApps(): Promise<AppDeskEligibleApp[]> {
  const res = await apiInstance.get<{ apps: AppDeskEligibleApp[] }>('/integrations/app-desk/apps');
  return res.data.apps;
}
