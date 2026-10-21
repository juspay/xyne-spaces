import { router } from 'expo-router';

export async function startAudioCall(
  channelId: string | null | undefined,
  conversationId?: string,
  targetUserIds?: string[],
): Promise<void> {
  if (conversationId && !targetUserIds?.length) {
    throw new Error('Thread calls require an explicit invitation list.');
  }
  router.push({
    pathname: '/(protected)/native-call',
    params: {
      channelId: channelId as string,
      initiateCall: 'true',
      ...(conversationId ? { conversationId } : {}),
      ...(targetUserIds ? { targetUserIds: JSON.stringify(targetUserIds) } : {}),
    },
  });
}
