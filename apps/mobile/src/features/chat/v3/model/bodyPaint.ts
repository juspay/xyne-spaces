import type { MessageRowModel } from './chatRow.types';
import { isJumboEmojiModel } from './jumboEmoji';

export type BodyPaint = 'jumbo' | 'inline-rich' | 'segments' | 'markdown';

/** v2 `showContent`: paint body text unless the bubble is attachments-only. */
export const showMessageBody = (
  model: Pick<
    MessageRowModel,
    'body' | 'mediaPreview' | 'rowKind' | 'ticketPreview' | 'isFlowJson'
  >,
): boolean => {
  if (model.rowKind === 'TICKET' || model.ticketPreview) {
    return false;
  }
  if (model.isFlowJson && model.body.flowParts.length > 0) {
    return true;
  }
  if (!model.body.isVisibleToCurrentUser) {
    return true;
  }
  return model.body.plainText.trim().length > 0 || !model.mediaPreview;
};

/**
 * Which body renderer matches the reserved height for this model.
 * Collapse is a line clamp on the *same* renderer — swapping to stripped
 * preview text on "Read more" is what shifted layout and dropped formatting.
 */
export const bodyPaintFor = (model: MessageRowModel): BodyPaint => {
  if (isJumboEmojiModel(model)) {
    return 'jumbo';
  }
  if (model.body.inlineMarkdown) {
    return 'inline-rich';
  }
  if (model.body.segments.some(segment => segment.kind === 'emoji')) {
    return 'segments';
  }
  return 'markdown';
};
