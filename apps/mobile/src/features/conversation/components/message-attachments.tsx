import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import {
  ConversationComposer,
  useConversationComposer,
} from '@/src/features/chat/v2/components/conversation-composer';
import { useMessageAttachmentViewer } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-attachments';

import { MESSAGE_EXTRAS_GAP } from '../constants';
import { formatShortRelative } from '../model/relative-time';
import { FileCard } from './file-card';

/**
 * A message with only files gets the file cards. Anything with an image or a
 * video keeps the shared attachments block, whose grid and viewer wiring are
 * the media's, and which draws its own file rows beneath the grid.
 */
export const MessageAttachments = memo(function MessageAttachments(): ReactElement | null {
  const { item, paintRow } = useConversationComposer();
  const { all: attachments, openAttachment } = useMessageAttachmentViewer(item);

  if (attachments.length === 0) return null;

  const onlyFiles = attachments.every(
    attachment => getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename) == null,
  );

  if (!onlyFiles) {
    return (
      <View style={{ marginTop: MESSAGE_EXTRAS_GAP }}>
        <ConversationComposer.Attachments className='mb-0' />
      </View>
    );
  }

  const senderName = paintRow?.senderPaintModel.displayName ?? '';
  const timeLabel = paintRow ? formatShortRelative(paintRow.createdAt, Date.now()) : '';

  return (
    <View style={{ marginTop: MESSAGE_EXTRAS_GAP, rowGap: MESSAGE_EXTRAS_GAP }}>
      {attachments.map(attachment => (
        <FileCard
          key={attachment.id}
          fileName={attachment.originalFilename ?? 'File'}
          mimetype={attachment.mimetype}
          senderName={senderName}
          timeLabel={timeLabel}
          onPress={() => openAttachment(attachment.id)}
        />
      ))}
    </View>
  );
});
