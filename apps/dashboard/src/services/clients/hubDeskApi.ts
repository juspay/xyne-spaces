import { apiInstance } from './apiClient';

export interface HubDesk {
  /** The installed app whose channels feed this desk; null once it is unlinked. */
  app: { id: string; name: string } | null;
}

export async function getHubDesk(channelId: string): Promise<HubDesk> {
  const res = await apiInstance.get<HubDesk>(`/hub-desks/${channelId}`);
  return res.data;
}

export interface HubChannel {
  id: string;
  name: string;
}

/** The app's channels on this desk, and the ones (created by the app, on no desk yet) that can be added. */
export async function listHubChannels(
  channelId: string,
): Promise<{ added: HubChannel[]; available: HubChannel[] }> {
  const res = await apiInstance.get<{ added: HubChannel[]; available: HubChannel[] }>(
    `/hub-desks/${channelId}/channels`,
  );
  return res.data;
}

export async function addHubChannel(channelId: string, sourceChannelId: string): Promise<void> {
  await apiInstance.post(`/hub-desks/${channelId}/channels`, { channelId: sourceChannelId });
}

export async function removeHubChannel(channelId: string, sourceChannelId: string): Promise<void> {
  await apiInstance.delete(`/hub-desks/${channelId}/channels/${sourceChannelId}`);
}
