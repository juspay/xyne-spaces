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
