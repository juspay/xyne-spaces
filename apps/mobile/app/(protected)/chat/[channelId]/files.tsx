import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LegendList } from '@legendapp/list/react-native';
import {
  File as FileIcon,
  Image as ImageIcon,
  Play,
  Video as VideoIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { FilesHeaderV3 } from '@/src/components/chat/files-header-v3';
import { haptics } from '@/src/utils/haptics';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';

const HEADER_RESERVED = 60;
const PAGE_SIZE = 20;
const ROW_HEIGHT = 64;
const THUMB_SIZE = 48;

type Attachment = {
  id: string;
  createdAt: number;
  createdBy: string;
  mimetype: string;
  originalFilename?: string | null;
  size?: number | null;
  isDeleted?: boolean | null;
};

type Anchor = {
  row: { attachementId: string; createdAt: number } | null;
  direction: 'forward' | 'backward';
};

const LATEST_ANCHOR: Anchor = { row: null, direction: 'forward' };

const formatBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

type RowProps = {
  attachment: Attachment;
  onPress: () => void;
  mutedForeground: string;
  foregroundColor: string;
};

const ImageRow = ({
  attachment,
  onPress,
  mutedForeground,
  foregroundColor,
}: RowProps): ReactElement => {
  const { uri, error } = useMtlsImage(attachment.id);
  const failed = !!error && !uri;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='flex-row items-center gap-3 px-4'
      style={{ height: ROW_HEIGHT }}
    >
      <View
        className='items-center justify-center overflow-hidden rounded bg-muted'
        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
      >
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            cachePolicy='memory-disk'
            recyclingKey={attachment.id}
            contentFit='cover'
          />
        ) : (
          <ImageIcon size={20} color={mutedForeground} strokeWidth={1.5} />
        )}
      </View>
      <Meta
        attachment={attachment}
        foregroundColor={foregroundColor}
        mutedForeground={mutedForeground}
      />
    </Pressable>
  );
};

const VideoRow = ({
  attachment,
  onPress,
  mutedForeground,
  foregroundColor,
}: RowProps): ReactElement => {
  const { uri: posterUri, error } = useMtlsThumbnail(attachment.id);
  const failed = !!error && !posterUri;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='flex-row items-center gap-3 px-4'
      style={{ height: ROW_HEIGHT }}
    >
      <View
        className='items-center justify-center overflow-hidden rounded bg-muted'
        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
      >
        {posterUri && !failed ? (
          <Image
            source={{ uri: posterUri }}
            style={{ width: '100%', height: '100%' }}
            cachePolicy='memory-disk'
            recyclingKey={attachment.id}
            contentFit='cover'
          />
        ) : (
          <VideoIcon size={20} color={mutedForeground} strokeWidth={1.5} />
        )}
        {!failed && (
          <View className='absolute inset-0 items-center justify-center'>
            <View className='h-6 w-6 items-center justify-center rounded-full bg-black/55'>
              <Play size={12} color='#fff' fill='#fff' />
            </View>
          </View>
        )}
      </View>
      <Meta
        attachment={attachment}
        foregroundColor={foregroundColor}
        mutedForeground={mutedForeground}
      />
    </Pressable>
  );
};

const FileRow = ({
  attachment,
  onPress,
  mutedForeground,
  foregroundColor,
}: RowProps): ReactElement => (
  <Pressable
    onPress={onPress}
    onPressIn={(): void => {
      void haptics.buttonTap();
    }}
    className='flex-row items-center gap-3 px-4'
    style={{ height: ROW_HEIGHT }}
  >
    <View
      className='items-center justify-center overflow-hidden rounded bg-muted'
      style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
    >
      <FileIcon size={20} color={mutedForeground} strokeWidth={1.5} />
    </View>
    <Meta
      attachment={attachment}
      foregroundColor={foregroundColor}
      mutedForeground={mutedForeground}
    />
  </Pressable>
);

const Meta = ({
  attachment,
  foregroundColor: _fg,
  mutedForeground: _mf,
}: {
  attachment: Attachment;
  foregroundColor: string;
  mutedForeground: string;
}): ReactElement => {
  const sizeText = formatBytes(attachment.size);
  return (
    <View className='min-w-0 flex-1'>
      <Text className='text-sm font-medium text-foreground' numberOfLines={1}>
        {attachment.originalFilename || 'Untitled'}
      </Text>
      <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
        {[attachment.mimetype, sizeText].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
};

const FilesScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;

  const [anchor, setAnchor] = useState<Anchor>(LATEST_ANCHOR);
  const [response, details] = useQuery(
    queries.getConversationAttachementsV2({
      channelId,
      limit: PAGE_SIZE,
      start: anchor.row,
      direction: anchor.direction,
    }),
    { enabled: !!channelId },
  );

  const [items, setItems] = useState<Attachment[]>([]);

  useEffect(() => {
    if (details?.type !== 'complete' || !response) return;
    const ordered = anchor.direction === 'backward' ? [...response].reverse() : [...response];
    setItems(ordered.filter(a => !a.isDeleted) as Attachment[]);
  }, [response, details?.type, anchor.direction]);

  const visibleRange = useRef<{ first: number; last: number } | null>(null);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length === 0) return;
      const first = viewableItems[0]?.index ?? 0;
      const last = viewableItems[viewableItems.length - 1]?.index ?? first;
      visibleRange.current = { first, last };
    },
    [],
  );

  const onEndReached = useCallback(() => {
    if (!visibleRange.current || items.length === 0) return;
    const idx = Math.max(0, visibleRange.current.first - 2);
    const anchorItem = items[idx];
    if (!anchorItem) return;
    setAnchor({
      row: { attachementId: anchorItem.id, createdAt: anchorItem.createdAt },
      direction: 'forward',
    });
  }, [items]);

  const onStartReached = useCallback(() => {
    if (!visibleRange.current || items.length === 0) return;
    if (!anchor.row) return;
    if (items.length < PAGE_SIZE) {
      setAnchor(LATEST_ANCHOR);
      return;
    }
    const idx = Math.min(items.length - 1, visibleRange.current.last + 2);
    const anchorItem = items[idx];
    if (!anchorItem) return;
    setAnchor({
      row: { attachementId: anchorItem.id, createdAt: anchorItem.createdAt },
      direction: 'backward',
    });
  }, [items, anchor.row]);

  const viewerItems = useMemo<AttachmentsViewerItem[]>(
    () =>
      items.map(a => ({
        id: a.id,
        mimetype: a.mimetype,
        originalFilename: a.originalFilename ?? undefined,
        size: a.size ?? undefined,
      })),
    [items],
  );

  const handlePress = useCallback(
    (attachment: Attachment) => {
      const index = viewerItems.findIndex(item => item.id === attachment.id);
      if (index < 0) return;
      openAttachmentsViewer(router, {
        attachments: viewerItems,
        initialIndex: index,
        source: { kind: 'other', id: channelId },
      });
    },
    [router, viewerItems, channelId],
  );

  const renderItem = useCallback(
    ({ item }: { item: Attachment }) => {
      const isImage = item.mimetype?.startsWith('image/');
      const isVideo = item.mimetype?.startsWith('video/');
      if (isImage) {
        return (
          <ImageRow
            attachment={item}
            onPress={() => handlePress(item)}
            mutedForeground={mutedForeground}
            foregroundColor={foregroundColor}
          />
        );
      }
      if (isVideo) {
        return (
          <VideoRow
            attachment={item}
            onPress={() => handlePress(item)}
            mutedForeground={mutedForeground}
            foregroundColor={foregroundColor}
          />
        );
      }
      return (
        <FileRow
          attachment={item}
          onPress={() => handlePress(item)}
          mutedForeground={mutedForeground}
          foregroundColor={foregroundColor}
        />
      );
    },
    [handlePress, mutedForeground, foregroundColor],
  );

  return (
    <View className='flex-1 bg-settings-bg'>
      <FilesHeaderV3 channelId={channelId} />

      <LegendList
        data={items}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        estimatedItemSize={ROW_HEIGHT}
        contentContainerStyle={{
          paddingTop: insets.top + HEADER_RESERVED,
          paddingBottom: insets.bottom + 16,
        }}
        onViewableItemsChanged={onViewableItemsChanged}
        onStartReached={onStartReached}
        onStartReachedThreshold={0}
        onEndReached={onEndReached}
        onEndReachedThreshold={0}
        maintainVisibleContentPosition
        ListEmptyComponent={
          <View className='items-center justify-center px-8 py-12'>
            <Text className='text-center text-secondary-foreground'>
              No attachments in this channel.
            </Text>
          </View>
        }
      />
    </View>
  );
};

export default FilesScreen;
