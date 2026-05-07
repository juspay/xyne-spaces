/**
 * Desk integration management — disconnect / reconnect for the email
 * channel attached to a desk. Both endpoints are gated server-side to the
 * desk owner (channel creator OR email-channel-preference owner).
 */

import { apiInstance } from './apiClient';

/**
 * Soft-disconnect: server clears credentials, marks the source inactive,
 * and best-effort revokes the token at the provider. Email history is
 * preserved.
 */
export async function disconnectDeskIntegration(channelId: string): Promise<void> {
  await apiInstance.post<{ success: true }>(`/integrations/desk/${channelId}/disconnect`);
}

/**
 * Returns the OAuth URL the user should be sent to. The server side has
 * already stored the reconnect state with `expectedEmail`, so the callback
 * will reject if the user signs in with a different mailbox.
 */
export async function initDeskIntegrationReconnect(
  channelId: string,
  platform: 'electron' | 'web' = 'web',
): Promise<string> {
  const res = await apiInstance.post<{ authUrl: string }>(
    `/integrations/desk/${channelId}/reconnect-init`,
    { platform },
  );
  return res.data.authUrl;
}
