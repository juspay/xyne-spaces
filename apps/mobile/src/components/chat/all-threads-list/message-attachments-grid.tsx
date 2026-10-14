import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Image as ImageIcon, Play, Video } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useRouter } from 'expo-router';
import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';

import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import { FileAttachmentCard } from '@/src/components/chat/file-attachment-card';
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_GRID_HEIGHT,
} from '@/src/components/conversation-composer/attachment-layout';
import type { MessageAttachment } from '@/src/hooks/useThreadConversationPreview';

const formatDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};

// ─── Single media cell ────────────────────────────────────────────────────────

type MediaCellProps = {
  attachment: MessageAttachment;
  overflowCount?: number;
  onPress?: () => void;
};

const MediaCell = memo(function MediaCell({ attachment, overflowCount, onPress }: MediaCellProps) {
  const mediaKind = getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename);
  const isImage = mediaKind === 'image';
  const isVideo = mediaKind === 'video';
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;

  const { uri: imageUri, error: imageError } = useMtlsImage(isImage ? attachment.id : undefined);
  const { uri: thumbUri, error: thumbError } = useMtlsThumbnail(
    isVideo ? attachment.id : undefined,
  );

  const fallbackUri = attachment.previewUri ?? null;
  const uri = isImage ? (imageUri ?? fallbackUri) : isVideo ? (thumbUri ?? fallbackUri) : null;
  const hasFailed = isImage ? !!imageError && !uri : isVideo ? !!thumbError && !uri : false;
  const duration = attachment.metadata?.duration;
  const showDuration = isVideo && typeof duration === 'number' && duration > 0 && !hasFailed;

  return (
    <Pressable
      onPress={onPress}
      className='flex-1 bg-muted rounded overflow-hidden'
      style={({ pressed }) => (pressed && !hasFailed ? { opacity: 0.85 } : null)}
    >
      {uri && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
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
          <Text className='text-white text-[10px] font-medium'>{formatDuration(duration!)}</Text>
        </View>
      )}
      {overflowCount !== undefined && overflowCount > 0 && (
        <View className='absolute inset-0 bg-black/50 items-center justify-center'>
          <Text className='text-white text-2xl font-semibold'>+{overflowCount}</Text>
        </View>
      )}
    </Pressable>
  );
});

// ─── Full grid ────────────────────────────────────────────────────────────────

type Props = {
  attachments: MessageAttachment[];
  conversationId: string;
};

export const MessageAttachmentsGrid = memo(function MessageAttachmentsGrid({
  attachments,
  conversationId,
}: Props) {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const gridMinWidth = Math.min(windowWidth * 0.6, 280);

  const media = attachments.filter(
    a => getAttachmentMediaKind(a.mimetype, a.originalFilename) !== null,
  );
  const files = attachments.filter(
    a => getAttachmentMediaKind(a.mimetype, a.originalFilename) === null,
  );

  const viewerItems = useMemo(
    () =>
      attachments.map(a => ({
        id: a.id,
        mimetype: a.mimetype,
        ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
        ...(a.size !== null && a.size !== undefined ? { size: a.size } : {}),
      })),
    [attachments],
  );

  const openAttachment = useCallback(
    (attachmentId: string) => {
      const index = viewerItems.findIndex(a => a.id === attachmentId);
      if (index < 0) return;
      openAttachmentsViewer(router, {
        attachments: viewerItems,
        initialIndex: index,
        source: { kind: 'message', id: conversationId },
      });
    },
    [router, viewerItems, conversationId],
  );

  if (attachments.length === 0) return null;

  const visible = media.slice(0, 4);
  const overflow = Math.max(0, media.length - 4);

  const filesBlock =
    files.length > 0 ? (
      <View className={media.length > 0 ? 'gap-1 mt-1.5' : 'gap-1'}>
        {files.map(file => (
          <FileAttachmentCard
            key={file.id}
            attachment={{
              id: file.id,
              originalFilename: file.originalFilename ?? file.id,
              mimetype: file.mimetype,
              size: file.size ?? 0,
            }}
            onPress={() => openAttachment(file.id)}
          />
        ))}
      </View>
    ) : null;

  const gridStyle = {
    height: ATTACHMENT_GRID_HEIGHT,
    width: '100%' as const,
    minWidth: gridMinWidth,
  };

  let mediaBlock: React.ReactNode = null;

  if (visible.length === 1) {
    mediaBlock = (
      <View style={gridStyle}>
        <MediaCell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
      </View>
    );
  } else if (visible.length === 2) {
    mediaBlock = (
      <View style={{ ...gridStyle, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
        <MediaCell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
        <MediaCell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
      </View>
    );
  } else if (visible.length === 3) {
    mediaBlock = (
      <View style={{ ...gridStyle, gap: ATTACHMENT_GRID_GAP }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          <MediaCell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
          <MediaCell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
        </View>
        <View style={{ flex: 1 }}>
          <MediaCell attachment={visible[2]!} onPress={() => openAttachment(visible[2]!.id)} />
        </View>
      </View>
    );
  } else if (visible.length >= 4) {
    mediaBlock = (
      <View style={{ ...gridStyle, gap: ATTACHMENT_GRID_GAP }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          <MediaCell attachment={visible[0]!} onPress={() => openAttachment(visible[0]!.id)} />
          <MediaCell attachment={visible[1]!} onPress={() => openAttachment(visible[1]!.id)} />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          <MediaCell attachment={visible[2]!} onPress={() => openAttachment(visible[2]!.id)} />
          <MediaCell
            attachment={visible[3]!}
            overflowCount={overflow}
            onPress={() => openAttachment(visible[3]!.id)}
          />
        </View>
      </View>
    );
  }

  return (
    <View className='mt-1.5 mb-1'>
      {mediaBlock}
      {filesBlock}
    </View>
  );
});
