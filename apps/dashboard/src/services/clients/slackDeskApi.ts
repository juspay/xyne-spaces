/**
 * Slack desk management — disconnect for the Slack channel attached to a
 * desk. The endpoint is gated server-side to the desk owner (channel creator
 * OR email-channel-preference owner) and soft-deactivates the channel's
 * ExternalSource (isActive = false).
 */

import { SlackDeskTriggerMode } from '@xyne/shared';
import { apiInstance } from './apiClient';

export { SlackDeskTriggerMode };

/**
 * Soft-disconnect: server marks the Slack channel's ExternalSource inactive.
 * Existing message history on the desk is preserved.
 */
export async function disconnectSlackDesk(
  channelId: string,
  slackChannelId: string,
): Promise<void> {
  await apiInstance.post<{ message: string }>(`/integrations/slack-desk/${channelId}/disconnect`, {
    slackChannelId,
  });
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

export async function listAvailableSlackChannels(): Promise<AvailableSlackChannel[]> {
  const { data } = await apiInstance.get<{ channels: AvailableSlackChannel[] }>(
    '/integrations/slack-desk/channels',
  );
  return data.channels;
}

export interface DeskSlackChannelsResponse {
  slackChannels: DeskSlackChannel[];
  triggerMode: SlackDeskTriggerMode;
}

export async function listDeskSlackChannels(channelId: string): Promise<DeskSlackChannelsResponse> {
  const { data } = await apiInstance.get<DeskSlackChannelsResponse>(
    `/integrations/slack-desk/channels/${channelId}/slack`,
  );
  return data;
}

export async function connectSlackToDesk(channelId: string, slackChannelId: string): Promise<void> {
  await apiInstance.post(`/integrations/slack-desk/channels/${channelId}/slack`, {
    slackChannelId,
  });
}

export async function updateSlackDeskTriggerMode(
  channelId: string,
  triggerMode: SlackDeskTriggerMode,
): Promise<void> {
  await apiInstance.patch(`/integrations/slack-desk/channels/${channelId}/slack/trigger-mode`, {
    triggerMode,
  });
}
