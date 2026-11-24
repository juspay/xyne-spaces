import {
  getLongMessageCollapseModel,
  shouldCollapseMessageBody,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';
import type {
  ChatPaintCollapseModel,
  ChatPaintRow,
} from '@/src/features/chat/v2/paint/chatPaint.types';

import { COLLAPSED_LINES, MESSAGE_BODY_CHAR_WIDTH } from '../constants';

const NOT_COLLAPSIBLE: ChatPaintCollapseModel = {
  isCollapsible: false,
  collapsedLines: COLLAPSED_LINES,
};

/**
 * Whether a flat body folds, by the chat's own long-message rules but at the
 * flat layout's 11 lines and measured at the flat body's width. Both the row
 * and its size estimate read this, so they agree on the folded height.
 */
export function flatCollapse(row: ChatPaintRow, bodyWidth: number): ChatPaintCollapseModel {
  if (row.isDeleted || !row.body.plainText.trim()) return NOT_COLLAPSIBLE;
  const model = getLongMessageCollapseModel({
    markdown: row.body.markdown,
    maxWidth: bodyWidth,
    charWidth: MESSAGE_BODY_CHAR_WIDTH,
    collapsedLines: COLLAPSED_LINES,
  });
  return {
    isCollapsible: shouldCollapseMessageBody(model, row.rowKind),
    collapsedLines: COLLAPSED_LINES,
  };
}
