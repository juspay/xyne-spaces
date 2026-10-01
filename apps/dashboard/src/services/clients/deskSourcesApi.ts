import { apiInstance } from './apiClient';

export interface ChannelFetchSource {
  sourceId: string;
  sourceType: 'google' | 'microsoft' | 'zoho' | 'app-desk';
  displayName: string;
  installedAppId?: string;
  isActive: boolean;
}

export async function getChannelFetchSources(channelId: string): Promise<ChannelFetchSource[]> {
  const res = await apiInstance.get<{ sources: ChannelFetchSource[] }>(
    `/external-source-sync/${channelId}/sources`,
  );
  return res.data.sources;
}
