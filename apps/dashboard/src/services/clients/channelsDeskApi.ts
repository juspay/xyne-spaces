import { apiInstance } from './apiClient';

export interface ChannelsDesk {
  /** The installed app whose channels feed this desk; null once it is unlinked. */
  app: { id: string; name: string } | null;
}

export async function getChannelsDesk(channelId: string): Promise<ChannelsDesk> {
  const res = await apiInstance.get<ChannelsDesk>(`/channels-desks/${channelId}`);
  return res.data;
}

export interface ChannelsDeskChannel {
  id: string;
  name: string;
}

/** The app's channels on this desk, and the ones (created by the app, on no desk yet) that can be added. */
export async function listChannelsDeskChannels(
  channelId: string,
): Promise<{ added: ChannelsDeskChannel[]; available: ChannelsDeskChannel[] }> {
  const res = await apiInstance.get<{
    added: ChannelsDeskChannel[];
    available: ChannelsDeskChannel[];
  }>(`/channels-desks/${channelId}/channels`);
  return res.data;
}

export async function addChannelsDeskChannel(
  channelId: string,
  sourceChannelId: string,
): Promise<void> {
  await apiInstance.post(`/channels-desks/${channelId}/channels`, { channelId: sourceChannelId });
}

export async function removeChannelsDeskChannel(
  channelId: string,
  sourceChannelId: string,
): Promise<void> {
  await apiInstance.delete(`/channels-desks/${channelId}/channels/${sourceChannelId}`);
}
