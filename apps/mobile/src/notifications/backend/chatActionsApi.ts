import { apiPost, apiRequest } from '@/src/services/apiClient';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';

import type { ReplyTarget } from '../types';

// Send a reply from a notification. Thread replies post into the thread
// conversation; main/DM replies create a new conversation in the channel (req #3).
export async function sendReply(target: ReplyTarget, plainText: string): Promise<void> {
  const headers = await buildAuthenticatedHeaders();
  const content = plainTextToHtml(plainText.trim());
  if (!content || content === '<p></p>') throw new Error('reply text is empty');

  if (target.kind === 'thread') {
    await apiPost(
      `/conversations/${target.conversationId}/messages`,
      { content, msgType: 'USER' },
      { headers },
    );
  } else {
    await apiPost(
      `/channels/${target.channelId}/conversations`,
      { content, msgType: 'USER' },
      { headers },
    );
  }
}

type MarkAsReadParams = {
  backendNotificationId: string;
  channelId?: string;
  conversationId?: string;
};

// Tell the backend this notification was read (PATCH /notifications/:id/read).
export async function markAsRead({
  backendNotificationId,
  channelId,
  conversationId,
}: MarkAsReadParams): Promise<void> {
  const headers = await buildAuthenticatedHeaders();
  const body: Record<string, string> = {};
  if (channelId) body['channelId'] = channelId;
  if (conversationId) body['conversationId'] = conversationId;

  await apiRequest<{ success: boolean }>(`/notifications/${backendNotificationId}/read`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
