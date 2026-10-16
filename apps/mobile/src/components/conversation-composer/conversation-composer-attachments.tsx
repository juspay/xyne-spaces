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
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { FileAttachmentCard } from '@/src/components/chat/file-attachment-card';
import { cn } from '@/src/utils/cn';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import { activeAttachmentsOf } from '@/src/utils/activeAttachments';
import { ATTACHMENT_GRID_GAP, ATTACHMENT_GRID_HEIGHT } from './attachment-layout';

const formatDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};

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
  chatOpenProfiler.count('attachment_cell_render');
  const isImage = attachment.mimetype?.startsWith('image/');
  const isVideo = attachment.mimetype?.startsWith('video/');
  if (isImage) chatOpenProfiler.count('attachment_cell_image');
  if (isVideo) chatOpenProfiler.count('attachment_cell_video');
  if ((isImage || isVideo) && allowMediaHydration) {
    chatOpenProfiler.count('media_hydration_allowed');
  } else if (isImage || isVideo) {
    chatOpenProfiler.count('media_hydration_deferred');
  }
  const { uri: imageUri, error: imageError } = useMtlsImage(isImage ? attachment.id : undefined, {
    enabled: allowMediaHydration,
  });
  const { uri: thumbUri, error: thumbError } = useMtlsThumbnail(
    isVideo ? attachment.id : undefined,
    { enabled: allowMediaHydration },
  );
  const uri = isImage ? imageUri : isVideo ? thumbUri : null;
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
  chatOpenProfiler.count('attachments_component_render');
  const { item, allowMediaHydration } = useConversationComposer();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const gridMinWidth = Math.min(windowWidth * 0.6, 280);
  const all = activeAttachmentsOf(item.initialMessageAttachments);
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
  chatOpenProfiler.count('attachments_component_non_empty');
  chatOpenProfiler.count('attachment_items_total', all.length);
  chatOpenProfiler.count('attachment_media_items_total', media.length);
  chatOpenProfiler.count('attachment_file_items_total', files.length);

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
