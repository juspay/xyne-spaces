import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { ExternalLink, Play } from 'lucide-react-native';
import { router } from 'expo-router';

import type { LinkPreview } from '@/src/features/chat/v2/paint/chatPaint.types';
import { apiPost } from '@/src/services/apiClient';
import { navigateToCallDeepLinkIfApplicable } from '@/src/utils/callDeepLink';
import { navigateToMessageDeepLinkIfApplicable } from '@/src/utils/messageDeepLink';
import { cn } from '@/src/utils/cn';
import { isSafeExternalUrl } from '@/src/utils/webViewSecurity';

type LinkPreviewCardProps = {
  preview: LinkPreview | null;
  isCurrentUser: boolean;
  mutedForeground: string;
  accentColor?: string;
  currentUserColors?: {
    backgroundColor: string;
    titleColor: string;
    mutedColor: string;
    accentColor: string;
  };
};

type LinkPreviewResponse = {
  success: boolean;
  data?: {
    url: string;
    title?: string;
    description?: string;
    siteName?: string;
    image?: string;
    favicon?: string;
  };
};

const metadataCache = new Map<string, LinkPreview>();
const metadataInflight = new Map<string, Promise<LinkPreview | null>>();

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

const mergePreviewMetadata = (
  base: LinkPreview,
  metadata: LinkPreviewResponse['data'],
): LinkPreview | null => {
  if (!metadata?.url) return null;
  return {
    ...base,
    url: metadata.url,
    title: metadata.title?.trim() || base.title,
    description: metadata.description?.trim() || base.description,
    siteName: metadata.siteName?.trim() || base.siteName,
    image: metadata.image || base.image,
    favicon: metadata.favicon || base.favicon,
    needsMetadataFetch: false,
  };
};

const fetchLinkPreviewMetadata = (preview: LinkPreview): Promise<LinkPreview | null> => {
  const cached = metadataCache.get(preview.url);
  if (cached) return Promise.resolve(cached);

  const inflight = metadataInflight.get(preview.url);
  if (inflight) return inflight;

  const request = apiPost<LinkPreviewResponse>('/link-preview', { url: preview.url })
    .then(response => {
      const merged = response.success ? mergePreviewMetadata(preview, response.data) : null;
      if (merged) metadataCache.set(preview.url, merged);
      return merged;
    })
    .catch(() => null)
    .finally(() => {
      metadataInflight.delete(preview.url);
    });

  metadataInflight.set(preview.url, request);
  return request;
};

const useResolvedLinkPreview = (preview: LinkPreview | null): LinkPreview | null => {
  const [resolved, setResolved] = useState<LinkPreview | null>(() => {
    if (!preview) return null;
    return metadataCache.get(preview.url) ?? preview;
  });

  useEffect(() => {
    if (!preview) {
      setResolved(null);
      return;
    }

    const cached = metadataCache.get(preview.url);
    setResolved(cached ?? preview);
    if (!preview.needsMetadataFetch || cached) return;

    let cancelled = false;
    void fetchLinkPreviewMetadata(preview).then(nextPreview => {
      if (!cancelled && nextPreview) {
        setResolved(nextPreview);
      }
    });

    return (): void => {
      cancelled = true;
    };
  }, [preview]);

  return resolved;
};

const LinkPreviewCardComponent = ({
  preview,
  isCurrentUser,
  mutedForeground,
  accentColor,
  currentUserColors,
}: LinkPreviewCardProps): ReactElement | null => {
  const resolvedPreview = useResolvedLinkPreview(preview);
  const youtubeVideoId = useMemo(
    () => (resolvedPreview ? getYoutubeVideoId(resolvedPreview.url) : null),
    [resolvedPreview],
  );

  if (!resolvedPreview) return null;

  const openLink = (): void => {
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
  const thumbnailUri =
    resolvedPreview.image ??
    (youtubeVideoId ? `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` : null);
  const sourceLabel = resolvedPreview.siteName || resolvedPreview.host;
  const currentColors = isCurrentUser ? currentUserColors : undefined;
  const sourceTextColor = currentColors?.mutedColor;
  const titleTextColor = currentColors?.titleColor;
  const descriptionTextColor = currentColors?.mutedColor;
  const iconColor = currentColors?.mutedColor ?? mutedForeground;
  const resolvedAccentColor = currentColors?.accentColor ?? accentColor ?? '#1B8755';

  return (
    <Pressable
      onPress={openLink}
      accessibilityRole='link'
      accessibilityLabel={resolvedPreview.title}
      className={cn(
        'mb-2.5 flex-row overflow-hidden rounded-[8px]',
        isCurrentUser && !currentColors ? 'bg-conversation-composer-forwarded-bg-user' : '',
        !isCurrentUser ? 'bg-conversation-composer-forwarded-bg-other' : '',
      )}
      style={[
        { minHeight: 86 },
        currentColors ? { backgroundColor: currentColors.backgroundColor } : null,
      ]}
    >
      <View className='w-1 shrink-0' style={{ backgroundColor: resolvedAccentColor }} />
      <View className='min-w-0 flex-1 gap-1 px-2.5 py-2'>
        <View className='min-w-0 flex-row items-center gap-1.5'>
          <Text
            className={cn(
              'min-w-0 shrink text-[12px] font-medium',
              currentColors ? '' : 'text-tertiary',
            )}
            style={sourceTextColor ? { color: sourceTextColor } : undefined}
            numberOfLines={1}
          >
            {sourceLabel}
          </Text>
          <ExternalLink size={12} color={iconColor} strokeWidth={2} />
        </View>
        <Text
          className={cn(
            'text-[14px] font-semibold leading-5',
            currentColors ? '' : 'text-foreground',
          )}
          style={titleTextColor ? { color: titleTextColor } : undefined}
          numberOfLines={1}
        >
          {resolvedPreview.title}
        </Text>
        {resolvedPreview.description ? (
          <Text
            className={cn('text-[12px] leading-4', currentColors ? '' : 'text-tertiary')}
            style={descriptionTextColor ? { color: descriptionTextColor } : undefined}
            numberOfLines={1}
          >
            {resolvedPreview.description}
          </Text>
        ) : null}
      </View>
      <View
        className='m-2 shrink-0 overflow-hidden rounded-[6px] bg-muted'
        style={{ width: 64, height: 48 }}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            // Explicit pixel size (not %) lets expo-image downsample the full-res OG
            // image to the 64×48 box instead of uploading a huge bitmap as a texture.
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
};

export const LinkPreviewCard = memo(LinkPreviewCardComponent);
LinkPreviewCard.displayName = 'LinkPreviewCard';
