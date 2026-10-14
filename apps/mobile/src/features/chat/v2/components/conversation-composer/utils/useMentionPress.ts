import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/src/contexts/AuthContext';
import { ChannelService } from '@/src/services/ChannelService';
import { navigateToCallDeepLinkIfApplicable } from '@/src/utils/callDeepLink';
import { tryOpenDashboardCanvasFromUrl } from '@/src/utils/canvasUrl';
import { navigateToMessageDeepLinkIfApplicable } from '@/src/utils/messageDeepLink';
import { isSafeExternalUrl } from '@/src/utils/webViewSecurity';

import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './htmlToMD';

export const useMentionPress = (): ((url: string) => Promise<void>) => {
  const router = useRouter();
  const { token } = useAuth();

  return useCallback(
    async (url: string) => {
      if (url.startsWith(MENTION_USER_SCHEME)) {
        const userId = decodeURIComponent(url.slice(MENTION_USER_SCHEME.length));

        if (!token) {
          Alert.alert('Error', 'Authentication required');
          return;
        }

        try {
          const channelService = new ChannelService(token);
          const response = await channelService.createDm({ participantIds: [userId] });
          router.push({
            pathname: '/chat/[channelId]',
            params: { channelId: response.id },
          });
        } catch {
          Alert.alert('Error', 'Failed to open direct message. Please try again.');
        }
        return;
      }

      if (url.startsWith(MENTION_CHANNEL_SCHEME)) {
        const channelId = decodeURIComponent(url.slice(MENTION_CHANNEL_SCHEME.length));
        router.push({
          pathname: '/chat/[channelId]',
          params: { channelId },
        });
        return;
      }

      if (url.startsWith(MENTION_GROUP_SCHEME)) {
        const groupId = decodeURIComponent(url.slice(MENTION_GROUP_SCHEME.length));
        router.push({
          pathname: '/chat/group-details/[groupId]',
          params: { groupId },
        });
        return;
      }

      if (url.startsWith(MENTION_BROADCAST_SCHEME)) {
        return;
      }

      if (navigateToCallDeepLinkIfApplicable(router, url)) {
        return;
      }

      if (navigateToMessageDeepLinkIfApplicable(router, url)) {
        return;
      }

      if (tryOpenDashboardCanvasFromUrl(router, url)) {
        return;
      }

      if (isSafeExternalUrl(url)) {
        void Linking.openURL(url).catch(() => undefined);
      }
    },
    [router, token],
  );
};
