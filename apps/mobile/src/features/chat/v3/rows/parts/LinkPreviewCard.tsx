import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ExternalLink, Play } from 'lucide-react-native';
import { memo, useMemo, type ReactElement } from 'react';
import { Linking, Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import { navigateToCallDeepLinkIfApplicable } from '@/src/utils/callDeepLink';
import { navigateToMessageDeepLinkIfApplicable } from '@/src/utils/messageDeepLink';
import { isSafeExternalUrl } from '@/src/utils/webViewSecurity';
import type { LinkPreview } from '../../model/chatRow.types';
import { LINK_PREVIEW_HEIGHT_PX } from '../../model/buildPreviews';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { useResolvedLinkPreview } from './useResolvedLinkPreview';

const getYoutubeVideoId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' && parsed.pathname === '/watch') {
      return parsed.searchParams.get('v');
    }
    return parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
};

function LinkPreviewCardView({
  preview,
  mine,
}: {
  preview: LinkPreview;
  mine: boolean;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const router = useRouter();
  const resolvedPreview = useResolvedLinkPreview(preview);
  const youtubeVideoId = useMemo(
    () => getYoutubeVideoId(resolvedPreview.url),
    [resolvedPreview.url],
  );
  const thumbnailUri =
    resolvedPreview.image ??
    (youtubeVideoId ? `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` : null);
  const sourceLabel = resolvedPreview.siteName || resolvedPreview.host;
  const mutedColor = mine ? tokens.embeddedMutedUser : tokens.mutedForeground;
  const titleColor = mine ? tokens.embeddedTitleUser : tokens.foreground;
  const accentColor = mine ? tokens.rootAccentUser : tokens.ambientAccentColor;

  const openLink = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    if (navigateToCallDeepLinkIfApplicable(router, resolvedPreview.url)) {
      return;
    }
    if (navigateToMessageDeepLinkIfApplicable(router, resolvedPreview.url)) {
      return;
    }
    if (isSafeExternalUrl(resolvedPreview.url)) {
      void Linking.openURL(resolvedPreview.url).catch(() => undefined);
    }
  };

  return (
    <Pressable
      accessibilityRole='link'
      accessibilityLabel={resolvedPreview.title}
      onPress={openLink}
      className='mb-2.5 flex-row overflow-hidden rounded-lg'
      style={{
        minHeight: LINK_PREVIEW_HEIGHT_PX,
        backgroundColor: mine ? tokens.embeddedBgUser : tokens.forwardedBgOther,
      }}
    >
      <View className='w-1 shrink-0' style={{ backgroundColor: accentColor }} />
      <View className='min-w-0 flex-1 gap-1 px-2.5 py-2'>
        <View className='min-w-0 flex-row items-center gap-1.5'>
          <Text
            className='min-w-0 shrink text-xs font-medium'
            numberOfLines={1}
            style={{ color: mutedColor }}
          >
            {sourceLabel}
          </Text>
          <ExternalLink size={12} color={mutedColor} strokeWidth={2} />
        </View>
        <Text
          className='text-sm font-semibold leading-5'
          numberOfLines={1}
          style={{ color: titleColor }}
        >
          {resolvedPreview.title}
        </Text>
        {resolvedPreview.description ? (
          <Text className='text-xs leading-4' numberOfLines={1} style={{ color: mutedColor }}>
            {resolvedPreview.description}
          </Text>
        ) : null}
      </View>
      <View
        className='m-2 shrink-0 overflow-hidden rounded-md bg-muted'
        style={{ width: 64, height: 48 }}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={{ width: 64, height: 48 }}
            cachePolicy='memory-disk'
            contentFit='cover'
            recyclingKey={thumbnailUri}
          />
        ) : null}
        {youtubeVideoId ? (
          <View className='absolute inset-0 items-center justify-center bg-black/10'>
            <View className='h-6 w-6 items-center justify-center rounded-full bg-black/60'>
              <Play size={11} color='#fff' fill='#fff' />
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export const LinkPreviewCard = memo(LinkPreviewCardView);
LinkPreviewCard.displayName = 'LinkPreviewCard';
