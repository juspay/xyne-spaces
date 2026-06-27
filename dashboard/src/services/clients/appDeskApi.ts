import { apiInstance } from './apiClient';

export async function disconnectAppDesk(channelId: string): Promise<void> {
  await apiInstance.post<{ message: string }>(`/integrations/app-desk/${channelId}/disconnect`);
}

export async function reconnectAppDesk(channelId: string): Promise<void> {
  await apiInstance.post<{ message: string }>(`/integrations/app-desk/${channelId}/reconnect`);
}
