import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { useMessageComposer } from './message-composer-context';
import type { MessageItem } from './message-composer.types';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { FileAttachmentCard } from '@/src/components/chat/file-attachment-card';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';

const GRID_HEIGHT = 220;
const GRID_MIN_WIDTH = 220;
const GAP = 2;

const formatDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};

type AttachmentItem = NonNullable<MessageItem['attachments']>[number];

type CellProps = {
  attachment: AttachmentItem;
  overflowCount?: number;
  onPress?: () => void;
};

const Cell = ({ attachment, overflowCount, onPress }: CellProps): ReactElement => {
  const isImage = attachment.mimetype?.startsWith('image/');
  const isVideo = attachment.mimetype?.startsWith('video/');
  const { uri: imageUri } = useMtlsImage(isImage ? attachment.id : undefined);
  const { uri: thumbUri } = useMtlsThumbnail(isVideo ? attachment.id : undefined);
  const uri = isImage ? imageUri : isVideo ? thumbUri : null;

  const duration = (attachment.metadata as { duration?: number } | null | undefined)?.duration;
  const showDuration = isVideo && typeof duration === 'number' && duration > 0;

  return (
    <Pressable
      onPress={onPress}
      className='flex-1 bg-muted rounded overflow-hidden'
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
    >
      {uri && (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          cachePolicy='memory-disk'
          recyclingKey={attachment.id}
          contentFit='contain'
        />
      )}
      {isVideo && (
        <View className='absolute inset-0 items-center justify-center pointer-events-none'>
          <View className='w-9 h-9 rounded-full bg-black/50 items-center justify-center'>
            <Play size={16} color='#fff' fill='#fff' />
          </View>
        </View>
      )}
      {showDuration && (
        <View className='absolute bottom-1 right-1 bg-black/50 rounded px-1.5 py-0.5 pointer-events-none'>
          <Text className='text-white text-[10px] font-medium'>{formatDuration(duration)}</Text>
        </View>
      )}
      {overflowCount !== undefined && overflowCount > 0 && (
        <View className='absolute inset-0 bg-black/50 items-center justify-center'>
          <Text className='text-white text-2xl font-semibold'>+{overflowCount}</Text>
        </View>
      )}
    </Pressable>
  );
};

type AttachmentsProps = {
  className?: string;
};

const Attachments = memo(({ className }: AttachmentsProps): ReactElement | null => {
  const { item } = useMessageComposer();
  const router = useRouter();
  const all = item.attachments ?? [];
  const media = all.filter(
    a => a.mimetype?.startsWith('image/') || a.mimetype?.startsWith('video/'),
  );
  const files = all.filter(
    a => !(a.mimetype?.startsWith('image/') || a.mimetype?.startsWith('video/')),
  );
  const viewerItems = useMemo<AttachmentsViewerItem[]>(
    () =>
      all.map(a => ({
        id: a.id,
        mimetype: a.mimetype,
        originalFilename: a.originalFilename ?? undefined,
        size: a.size,
      })),
    [all],
  );

  const openAttachment = useCallback(
    (attachmentId: string) => {
      const index = viewerItems.findIndex(attachment => attachment.id === attachmentId);
      if (index < 0) return;
      openAttachmentsViewer(router, {
        attachments: viewerItems,
        initialIndex: index,
        source: { kind: 'message', id: item.messageId },
      });
    },
    [router, viewerItems, item.messageId],
  );

  if (all.length === 0) return null;

  const visible = media.slice(0, 4);
  const overflow = Math.max(0, media.length - 4);
  const rootClass = cn('mb-1 mt-1.5', className);

  const baseStyle = { height: GRID_HEIGHT, minWidth: GRID_MIN_WIDTH };

  const filesBlock =
    files.length > 0 ? (
      <View className={cn('gap-1', media.length > 0 && 'mt-1.5')}>
        {files.map(file => (
          <FileAttachmentCard
            key={file.id}
            attachment={file}
            onPress={() => openAttachment(file.id)}
          />
        ))}
      </View>
    ) : null;

  if (visible.length === 1) {
    return (
      <DebugBoundary>
        <View className={rootClass}>
          <View style={baseStyle}>
            <Cell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
          </View>
          {filesBlock}
        </View>
      </DebugBoundary>
    );
  }

  if (visible.length === 2) {
    return (
      <DebugBoundary>
        <View className={rootClass}>
          <View style={{ ...baseStyle, flexDirection: 'row', gap: GAP }}>
            <Cell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
            <Cell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
          </View>
          {filesBlock}
        </View>
      </DebugBoundary>
    );
  }

  if (visible.length === 3) {
    return (
      <DebugBoundary>
        <View className={rootClass}>
          <View style={{ ...baseStyle, gap: GAP }}>
            <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
              <Cell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
              <Cell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
            </View>
            <View style={{ flex: 1 }}>
              <Cell attachment={visible[2]!} onPress={() => openAttachment(visible[2]!.id)} />
            </View>
          </View>
          {filesBlock}
        </View>
      </DebugBoundary>
    );
  }

  if (visible.length === 0) {
    return (
      <DebugBoundary>
        <View className={rootClass}>{filesBlock}</View>
      </DebugBoundary>
    );
  }

  return (
    <DebugBoundary>
      <View className={rootClass}>
        <View style={{ ...baseStyle, gap: GAP }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
            <Cell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
            <Cell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
          </View>
          <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
            <Cell attachment={visible[2]!} onPress={() => openAttachment(visible[2]!.id)} />
            <Cell
              attachment={visible[3]!}
              overflowCount={overflow}
              onPress={() => openAttachment(visible[3]!.id)}
            />
          </View>
        </View>
        {filesBlock}
      </View>
    </DebugBoundary>
  );
});
Attachments.displayName = 'MessageComposer.Attachments';

export { Attachments };
