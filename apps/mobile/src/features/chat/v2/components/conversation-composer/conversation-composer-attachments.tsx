import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Image as ImageIcon, Play, Video } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useRouter } from 'expo-router';
import { useConversationComposer } from './conversation-composer-context';
import type { ConversationItem } from './conversation-composer.types';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { FileAttachmentCard } from '@/src/components/chat/file-attachment-card';
import { cn } from '@/src/utils/cn';
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_GRID_HEIGHT,
  formatAttachmentDuration,
} from './attachment-layout';
import {
  invalidateMediaPreview,
  useMediaPreviewUri,
} from '@/src/features/chat/v2/media/mediaPreviewCache';
import { activeAttachmentsOf } from '@/src/utils/activeAttachments';

type AttachmentItem = NonNullable<ConversationItem['initialMessageAttachments']>[number];

type CellProps = {
  attachment: AttachmentItem;
  allowMediaHydration: boolean;
  overflowCount?: number;
  onPress?: () => void;
};

const Cell = ({
  attachment,
  allowMediaHydration,
  overflowCount,
  onPress,
}: CellProps): ReactElement => {
  const mediaKind = getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename);
  const isImage = mediaKind === 'image';
  const isVideo = mediaKind === 'video';
  const { uri: imageUri, error: imageError } = useMtlsImage(isImage ? attachment.id : undefined, {
    enabled: allowMediaHydration,
  });
  const { uri: thumbUri, error: thumbError } = useMtlsThumbnail(
    isVideo ? attachment.id : undefined,
    { enabled: allowMediaHydration },
  );
  const previewUri = useMediaPreviewUri(
    isImage || isVideo ? attachment.id : null,
    isVideo ? 'video' : isImage ? 'image' : null,
  );
  const uri = isImage ? (imageUri ?? previewUri) : isVideo ? (thumbUri ?? previewUri) : null;
  const fetchError = isImage ? imageError : isVideo ? thumbError : null;
  const hasFailed = !!fetchError && !uri;

  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;

  const duration = (attachment.metadata as { duration?: number } | null | undefined)?.duration;
  const showDuration = isVideo && typeof duration === 'number' && duration > 0 && !hasFailed;

  return (
    <Pressable
      onPress={hasFailed ? undefined : onPress}
      disabled={hasFailed}
      className='flex-1 bg-muted rounded overflow-hidden'
      style={({ pressed }) => (pressed && !hasFailed ? { opacity: 0.85 } : null)}
    >
      {uri && (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          cachePolicy='memory-disk'
          recyclingKey={attachment.id}
          contentFit='contain'
          onError={() => {
            if (previewUri && uri === previewUri) {
              invalidateMediaPreview(
                attachment.id,
                isVideo ? 'video' : isImage ? 'image' : null,
                previewUri,
              );
            }
          }}
        />
      )}
      {hasFailed && (
        <View className='absolute inset-0 items-center justify-center px-2'>
          {isVideo ? (
            <Video size={28} color={mutedForeground} strokeWidth={1.5} />
          ) : (
            <ImageIcon size={28} color={mutedForeground} strokeWidth={1.5} />
          )}
          <Text className='mt-1.5 text-[11px] text-muted-foreground text-center' numberOfLines={1}>
            Preview not available
          </Text>
        </View>
      )}
      {isVideo && !hasFailed && (
        <View className='absolute inset-0 items-center justify-center pointer-events-none'>
          <View className='w-9 h-9 rounded-full bg-black/50 items-center justify-center'>
            <Play size={16} color='#fff' fill='#fff' />
          </View>
        </View>
      )}
      {showDuration && (
        <View className='absolute bottom-1 right-1 bg-black/50 rounded px-1.5 py-0.5 pointer-events-none'>
          <Text className='text-white text-[10px] font-medium'>
            {formatAttachmentDuration(duration)}
          </Text>
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
  const { item, allowMediaHydration } = useConversationComposer();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const gridMinWidth = Math.min(windowWidth * 0.6, 280);
  const all = useMemo(
    () => activeAttachmentsOf(item.initialMessageAttachments),
    [item.initialMessageAttachments],
  );
  const media = useMemo(
    () => all.filter(a => getAttachmentMediaKind(a.mimetype, a.originalFilename) != null),
    [all],
  );
  const files = useMemo(
    () => all.filter(a => getAttachmentMediaKind(a.mimetype, a.originalFilename) == null),
    [all],
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
        source: { kind: 'message', id: item.conversationId },
      });
    },
    [router, viewerItems, item.conversationId],
  );

  const renderMediaCell = useCallback(
    (attachment: AttachmentItem, overflowCount?: number): ReactElement => (
      <Cell
        attachment={attachment}
        allowMediaHydration={allowMediaHydration}
        {...(overflowCount !== undefined ? { overflowCount } : {})}
        onPress={() => openAttachment(attachment.id)}
      />
    ),
    [allowMediaHydration, openAttachment],
  );

  if (all.length === 0) return null;

  const visible = media.slice(0, 4);
  const overflow = Math.max(0, media.length - 4);
  const rootClass = cn('mb-2.5', className);

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
      <View className={rootClass}>
        <View style={{ height: ATTACHMENT_GRID_HEIGHT, width: '100%', minWidth: gridMinWidth }}>
          {renderMediaCell(visible[0]!)}
        </View>
        {filesBlock}
      </View>
    );
  }

  if (visible.length === 2) {
    return (
      <View className={rootClass}>
        <View
          style={{
            height: ATTACHMENT_GRID_HEIGHT,
            width: '100%',
            minWidth: gridMinWidth,
            flexDirection: 'row',
            gap: ATTACHMENT_GRID_GAP,
          }}
        >
          {renderMediaCell(visible[0]!)}
          {renderMediaCell(visible[1]!)}
        </View>
        {filesBlock}
      </View>
    );
  }

  if (visible.length === 3) {
    return (
      <View className={rootClass}>
        <View
          style={{
            height: ATTACHMENT_GRID_HEIGHT,
            width: '100%',
            minWidth: gridMinWidth,
            gap: ATTACHMENT_GRID_GAP,
          }}
        >
          <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
            {renderMediaCell(visible[0]!)}
            {renderMediaCell(visible[1]!)}
          </View>
          <View style={{ flex: 1 }}>{renderMediaCell(visible[2]!)}</View>
        </View>
        {filesBlock}
      </View>
    );
  }

  if (visible.length === 0) {
    return <View className={rootClass}>{filesBlock}</View>;
  }

  return (
    <View className={rootClass}>
      <View
        style={{
          height: ATTACHMENT_GRID_HEIGHT,
          width: '100%',
          minWidth: gridMinWidth,
          gap: ATTACHMENT_GRID_GAP,
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          {renderMediaCell(visible[0]!)}
          {renderMediaCell(visible[1]!)}
        </View>
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          {renderMediaCell(visible[2]!)}
          {renderMediaCell(visible[3]!, overflow)}
        </View>
      </View>
      {filesBlock}
    </View>
  );
});
Attachments.displayName = 'ConversationComposer.Attachments';

export { Attachments };
