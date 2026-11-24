import { memo, useCallback, useRef, type ReactElement } from 'react';
import { ScrollView } from 'react-native';

import { useChatInputComposerState } from '@/src/components/input-composer';
import { useComposerAttachmentActions } from '@/src/components/input-composer/hooks/useComposerAttachmentActions';

import {
  TYPING_BAR_ATTACHMENT_GAP,
  TYPING_BAR_ATTACHMENT_PADDING_TOP,
  TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
  TYPING_BAR_FIELD_PADDING_LEFT,
  TYPING_BAR_FIELD_PADDING_RIGHT,
  TYPING_BAR_FIELD_PADDING_Y,
} from '../constants';
import { RoomAttachmentTile } from './room-attachment-tile';

/** Reaches the field's edges, so the tiles scroll out under its rounded sides. */
const STRIP_STYLE = {
  marginTop: -TYPING_BAR_FIELD_PADDING_Y,
  marginLeft: -TYPING_BAR_FIELD_PADDING_LEFT,
  marginRight: -TYPING_BAR_FIELD_PADDING_RIGHT,
} as const;
/** Each tile pads its top and right for its remove button; the strip gives that back. */
const CONTENT_STYLE = {
  gap: TYPING_BAR_ATTACHMENT_GAP - TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
  paddingTop: TYPING_BAR_ATTACHMENT_PADDING_TOP - TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
  paddingLeft: TYPING_BAR_FIELD_PADDING_LEFT,
  paddingRight: TYPING_BAR_FIELD_PADDING_LEFT - TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
} as const;

/**
 * The draft's attachments as a row of tiles inside the field, above the
 * words. Removing and retrying go through the composer's own attachment
 * actions; adding (and its limit) stays with the "+" tray's pickers.
 */
function RoomAttachmentStripComponent(): ReactElement | null {
  const { attachments } = useChatInputComposerState();
  const { remove, retry } = useComposerAttachmentActions();
  const scrollRef = useRef<ScrollView>(null);
  const widthRef = useRef(0);
  // A new tile lands at the end, so the row follows it there; one going away leaves the scroll be.
  const handleContentSizeChange = useCallback((width: number): void => {
    const grew = width > widthRef.current;
    widthRef.current = width;
    if (grew) scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  if (attachments.length === 0) return null;

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps='handled'
      style={STRIP_STYLE}
      contentContainerStyle={CONTENT_STYLE}
      onContentSizeChange={handleContentSizeChange}
    >
      {attachments.map(attachment => (
        <RoomAttachmentTile
          key={attachment.attachmentId}
          attachment={attachment}
          onRemove={remove}
          onRetry={retry}
        />
      ))}
    </ScrollView>
  );
}

export const RoomAttachmentStrip = memo(RoomAttachmentStripComponent);
RoomAttachmentStrip.displayName = 'RoomAttachmentStrip';
