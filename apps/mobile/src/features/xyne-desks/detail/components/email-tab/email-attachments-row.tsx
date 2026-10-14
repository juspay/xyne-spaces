import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Paperclip } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';

import type { TicketDetailEmailAttachmentSnapshot } from '../../types';
import { visibleEmailAttachments } from '../../utils';

const THUMB_SIZE = 112;

type EmailAttachmentsRowProps = {
  attachments: readonly TicketDetailEmailAttachmentSnapshot[];
  body: string | null;
  conversationId: string | null;
};

export const EmailAttachmentsRow = memo(function EmailAttachmentsRow({
  attachments,
  body,
  conversationId,
}: EmailAttachmentsRowProps): ReactElement | null {
  const router = useRouter();
  const visible = useMemo(
    () => visibleEmailAttachments(attachments ?? [], body),
    [attachments, body],
  );

  const viewerItems = useMemo(
    () =>
      visible.map(attachment => ({
        id: attachment.id,
        mimetype: attachment.mimetype,
        originalFilename: attachment.originalFilename,
        size: attachment.size,
      })),
    [visible],
  );

  const openAttachment = useCallback(
    (attachmentId: string): void => {
      const index = viewerItems.findIndex(item => item.id === attachmentId);
      if (index < 0) return;
      openAttachmentsViewer(router, {
        attachments: viewerItems,
        initialIndex: index,
        source: conversationId
          ? { kind: 'ticket', id: conversationId }
          : { kind: 'other', id: attachmentId },
      });
    },
    [conversationId, router, viewerItems],
  );

  if (visible.length === 0) return null;

  return (
    <View className='mt-3 flex-row flex-wrap gap-2'>
      {visible.map(attachment =>
        attachment.mimetype.startsWith('image/') ? (
          <EmailAttachmentThumbnail
            key={attachment.id}
            attachment={attachment}
            onPress={() => openAttachment(attachment.id)}
          />
        ) : (
          <EmailAttachmentFileChip
            key={attachment.id}
            attachment={attachment}
            onPress={() => openAttachment(attachment.id)}
          />
        ),
      )}
    </View>
  );
});

function EmailAttachmentThumbnail({
  attachment,
  onPress,
}: {
  attachment: TicketDetailEmailAttachmentSnapshot;
  onPress: () => void;
}): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const { uri, isLoading } = useMtlsImage(attachment.id);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={attachment.originalFilename}
      onPress={onPress}
      className='overflow-hidden rounded-xl border border-foreground/10 bg-foreground/5'
      style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
    >
      {uri ? (
        <Image source={{ uri }} className='h-full w-full' resizeMode='cover' />
      ) : (
        <View className='h-full w-full items-center justify-center'>
          {isLoading ? (
            <ActivityIndicator size='small' color={muted} />
          ) : (
            <Paperclip size={22} color={muted} strokeWidth={2} />
          )}
        </View>
      )}
      <View className='absolute inset-x-0 bottom-0 bg-black/45 px-1.5 py-1'>
        <Text className='text-[10px] text-white' numberOfLines={1}>
          {attachment.originalFilename}
        </Text>
      </View>
    </Pressable>
  );
}

function EmailAttachmentFileChip({
  attachment,
  onPress,
}: {
  attachment: TicketDetailEmailAttachmentSnapshot;
  onPress: () => void;
}): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const sizeLabel = attachment.size > 0 ? formatFileSize(attachment.size) : '';

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={attachment.originalFilename}
      onPress={onPress}
      className='max-w-[260px] flex-row items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2'
    >
      <Paperclip size={14} color={muted} strokeWidth={2.2} />
      <View className='min-w-0'>
        <Text className='text-[13px] font-medium text-foreground' numberOfLines={1}>
          {attachment.originalFilename}
        </Text>
        {sizeLabel ? (
          <Text className='text-[11px] text-foreground/55' numberOfLines={1}>
            {sizeLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
