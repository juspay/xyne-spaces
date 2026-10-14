import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getLongMessageCollapseModel,
  shouldCollapseMessageBody,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';

const LONG_NUMBERED_LIST = Array.from(
  { length: 24 },
  (_, index) => `${index + 1}. A long list item with enough content to wrap on mobile screens.`,
).join('\n');
const FIVE_ITEM_LIST = Array.from(
  { length: 5 },
  (_, index) =>
    `${index + 1}. Post update of the app, 'read more' button is not visible and unable to view the full message. Please fix this asap as Sev2`,
).join('\n');

describe('long message collapse policy', () => {
  it('collapses long numbered lists instead of treating every list as permanently expanded', () => {
    const model = getLongMessageCollapseModel({
      markdown: LONG_NUMBERED_LIST,
      maxWidth: 280,
      viewportHeight: 800,
    });

    assert.equal(model.shouldCollapse, true);
    assert.equal(shouldCollapseMessageBody(model, 'OTHER_USER'), true);
    assert.equal(shouldCollapseMessageBody(model, 'BOT'), true);
  });

  it('collapses a visually tall numbered list even when prose length is below the text threshold', () => {
    const model = getLongMessageCollapseModel({
      markdown: FIVE_ITEM_LIST,
      maxWidth: 280,
      viewportHeight: 760,
    });

    assert.equal(model.readableCharacterCount < 650, true);
    assert.equal(model.estimatedLineCount >= model.collapsedNumberOfLines + 3, true);
    assert.equal(shouldCollapseMessageBody(model, 'OTHER_USER'), true);
  });
});
