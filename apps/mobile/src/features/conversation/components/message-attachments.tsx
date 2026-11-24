import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import { useConversationComposer } from '@/src/features/chat/v2/components/conversation-composer';
import { useMessageAttachmentViewer } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-attachments';

import { MESSAGE_EXTRAS_GAP } from '../constants';
import { formatShortRelative } from '../model/relative-time';
import { useConversationBodyWidth } from './conversation-palette';
import { FileCard } from './file-card';
import { PhotoGrid, type PhotoGridItem } from './photo-grid';

const EXTRAS_STYLE = { marginTop: MESSAGE_EXTRAS_GAP, rowGap: MESSAGE_EXTRAS_GAP } as const;

/**
 * A message's photos and videos as one flat grid, then a file card per file.
 * Lite and rich rows draw the same grid: a lite row only holds back the full
 * pictures, so the row keeps its height when they arrive. Every tap opens the
 * shared viewer on the tapped attachment, among all of the message's.
 */
export const MessageAttachments = memo(function MessageAttachments(): ReactElement | null {
  const { item, paintRow, allowMediaHydration } = useConversationComposer();
  const { all: attachments, openAttachment } = useMessageAttachmentViewer(item);
  const bodyWidth = useConversationBodyWidth();
  const { media, files } = useMemo(() => {
    const photos: PhotoGridItem[] = [];
    const rest: typeof attachments = [];
    for (const attachment of attachments) {
      const kind = getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename);
      if (kind) photos.push({ id: attachment.id, kind, metadata: attachment.metadata });
      else rest.push(attachment);
    }
    return { media: photos, files: rest };
  }, [attachments]);

  if (attachments.length === 0) return null;

  const senderName = paintRow?.senderPaintModel.displayName ?? '';
  // Read as the row renders, like the thread strip's time; it refreshes with the row.
  const timeLabel = paintRow ? formatShortRelative(paintRow.createdAt, Date.now()) : '';

  return (
    <View style={EXTRAS_STYLE}>
      {media.length > 0 ? (
        <PhotoGrid
          items={media}
          bodyWidth={bodyWidth}
          hydrate={allowMediaHydration}
          onOpen={openAttachment}
        />
      ) : null}
      {files.map(file => (
        <FileCard
          key={file.id}
          attachmentId={file.id}
          fileName={file.originalFilename ?? 'File'}
          mimetype={file.mimetype}
          sizeBytes={file.size}
          senderName={senderName}
          timeLabel={timeLabel}
          onOpen={openAttachment}
        />
      ))}
    </View>
  );
});
