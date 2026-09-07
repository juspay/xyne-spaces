/**
 * Slack desk management — disconnect for the Slack channel attached to a
 * desk. The endpoint is gated server-side to the desk owner (channel creator
 * OR email-channel-preference owner) and soft-deactivates the channel's
 * ExternalSource (isActive = false).
 */

import { apiInstance } from './apiClient';

/**
 * Soft-disconnect: server marks the Slack channel's ExternalSource inactive.
 * Existing message history on the desk is preserved.
 */
export async function disconnectSlackDesk(channelId: string): Promise<void> {
  await apiInstance.post<{ message: string }>(`/integrations/slack-desk/${channelId}/disconnect`);
}

export interface DeskSlackChannel {
  sourceId: string;
  slackChannelId: string | null;
}

export interface AvailableSlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  alreadyConnected: boolean;
}

/** Slack channels the bot is a member of, across the workspace. */
export async function listAvailableSlackChannels(): Promise<AvailableSlackChannel[]> {
  const { data } = await apiInstance.get<{ channels: AvailableSlackChannel[] }>(
    '/integrations/slack-desk/channels',
  );
  return data.channels;
}

export async function listDeskSlackChannels(channelId: string): Promise<DeskSlackChannel[]> {
  const { data } = await apiInstance.get<{ slackChannels: DeskSlackChannel[] }>(
    `/integrations/slack-desk/channels/${channelId}/slack`,
  );
  return data.slackChannels;
}

export async function connectSlackToDesk(channelId: string, slackChannelId: string): Promise<void> {
  await apiInstance.post(`/integrations/slack-desk/channels/${channelId}/slack`, {
    slackChannelId,
  });
}
