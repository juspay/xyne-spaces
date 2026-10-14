import { type ReactElement, useMemo } from 'react';
import { View } from 'react-native';

import { MessageAttachmentsGrid } from '@/src/components/chat/all-threads-list/message-attachments-grid';
import type { MessageAttachment } from '@/src/hooks/useThreadConversationPreview';

import type { MediaItem, MediaPreview } from '../model/chatRow.types';

const gridItemFrom = (item: MediaItem, preview: MediaPreview): MessageAttachment => ({
  id: item.id,
  mimetype: item.mimetype,
  ...(item.originalFilename ? { originalFilename: item.originalFilename } : {}),
  ...(typeof item.size === 'number' ? { size: item.size } : {}),
  ...(typeof item.durationSeconds === 'number'
    ? { metadata: { duration: item.durationSeconds } }
    : {}),
  ...(item.id === preview.attachmentId && preview.cachedThumbUri
    ? { previewUri: preview.cachedThumbUri }
    : {}),
});

/**
 * Same shared grid v2 uses: mTLS image/video thumbs, file cards, viewer.
 * Height is reserved by `buildMedia` so this cannot change geometry (P5).
 */
export function MessageRowMedia({
  media,
  conversationId,
}: {
  media: MediaPreview;
  conversationId: string;
}): ReactElement {
  const attachments = useMemo(() => media.items.map(item => gridItemFrom(item, media)), [media]);
  return (
    <View className='w-full overflow-hidden' style={{ height: media.reservedHeightPx }}>
      <MessageAttachmentsGrid attachments={attachments} conversationId={conversationId} />
    </View>
  );
}
