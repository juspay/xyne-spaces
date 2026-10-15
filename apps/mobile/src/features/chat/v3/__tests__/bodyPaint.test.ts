import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bodyPaintFor, showMessageBody } from '../model/bodyPaint';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { applyRowPresentation } from '../model/applyRowPresentation';
import type { MessageRowModel } from '../model/chatRow.types';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
  createdAt: DAY,
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '',
  markdown: 'hello',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: null,
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const ctx = {
  channelId: 'ch',
  channelKind: 'channel' as const,
  currentUserId: 'me',
};

const modelOf = (over: Partial<ConversationInput>): MessageRowModel => {
  const row = buildRows([input(over)], ctx).find(item => item.type === 'message');
  if (!row || row.type !== 'message') {
    throw new Error('expected a message row');
  }
  return row.model;
};

const longMarkdown = (): string =>
  Array.from({ length: 20 }, (_, i) => `${i + 1}. item with enough words to wrap on a phone`).join(
    '\n',
  );

describe('bodyPaintFor', (): void => {
  it('uses inline-rich for controlled markdown', (): void => {
    assert.equal(bodyPaintFor(modelOf({ markdown: 'Hello **Ada**' })), 'inline-rich');
  });

  it('marks encoded self mentions and broadcasts as targeting the viewer', (): void => {
    const viewerId = 'me/one';
    const row = buildRows(
      [
        input({
          markdown: `[@me](xyne://user/${encodeURIComponent(viewerId)}) [@here](xyne://broadcast/here)`,
        }),
      ],
      { ...ctx, currentUserId: viewerId },
    ).find(item => item.type === 'message');
    assert.ok(row && row.type === 'message');
    const mentions = row.model.body.segments.filter(segment => segment.kind === 'mention');
    assert.deepEqual(
      mentions.map(segment => segment.mentionsYou),
      [true, true],
    );
  });

  it('uses segments when custom emoji sits beside text', (): void => {
    assert.equal(bodyPaintFor(modelOf({ markdown: 'hi xemoji:e1:wave:emojix' })), 'segments');
  });

  it('uses jumbo when the body is 1–3 custom emoji only', (): void => {
    assert.equal(bodyPaintFor(modelOf({ markdown: 'xemoji:e1:wave:emojix' })), 'jumbo');
  });

  it('uses markdown for block constructs', (): void => {
    assert.equal(bodyPaintFor(modelOf({ markdown: '## heading\n\nA paragraph' })), 'markdown');
  });

  it('keeps the same renderer when a long body is collapsed', (): void => {
    const model = modelOf({ markdown: longMarkdown() });
    assert.equal(model.body.collapse.isCollapsible, true);
    assert.equal(bodyPaintFor(model), 'markdown');
  });

  it('does not put Read more on a short paragraph', (): void => {
    const model = modelOf({
      markdown: 'This is a short update. Please take a look when you can.',
    });
    assert.equal(model.body.collapse.isCollapsible, false);
  });

  it('leaves collapsed paint after the user expands', (): void => {
    const row = buildRows([input({ markdown: longMarkdown() })], ctx).find(
      item => item.type === 'message',
    );
    assert.ok(row && row.type === 'message');
    const painted = applyRowPresentation([row], {
      expandedIds: new Set(['c1']),
      highlightedConversationId: null,
    });
    const expanded = painted[0];
    assert.ok(expanded && expanded.type === 'message');
    assert.equal(expanded.model.isExpanded, true);
    assert.notEqual(bodyPaintFor(expanded.model), 'jumbo');
    assert.equal(bodyPaintFor(expanded.model), 'markdown');
  });

  it('does not collapse flow-json plan bodies', (): void => {
    const html =
      '<div data-flow-json="{&quot;version&quot;:&quot;2.0&quot;,&quot;screenId&quot;:&quot;s1&quot;,&quot;title&quot;:&quot;Flow JSON&quot;,&quot;components&quot;:[{&quot;type&quot;:&quot;plan&quot;,&quot;props&quot;:{&quot;title&quot;:&quot;Acknowledge PR&quot;,&quot;status&quot;:&quot;in_progress&quot;,&quot;description&quot;:&quot;' +
      longMarkdown().replace(/\n/g, ' ') +
      '&quot;}}]}"></div>';
    const model = modelOf({ html, markdown: '', isFlowJson: false });
    assert.equal(model.isFlowJson, true);
    assert.notEqual(bodyPaintFor(model), 'jumbo');
    assert.equal(model.body.flowParts.length, 1);
  });
});

describe('showMessageBody', (): void => {
  it('hides body chrome for attachment-only bubbles', (): void => {
    const model = modelOf({
      markdown: '',
      attachments: [
        { id: 'a1', mimetype: 'image/png', originalFilename: 'shot.png', width: 100, height: 100 },
      ],
    });
    assert.ok(model.mediaPreview);
    assert.equal(showMessageBody(model), false);
  });

  it('shows body when text accompanies attachments', (): void => {
    const model = modelOf({
      markdown: 'see attached',
      attachments: [
        { id: 'a1', mimetype: 'image/png', originalFilename: 'shot.png', width: 100, height: 100 },
      ],
    });
    assert.ok(model.mediaPreview);
    assert.equal(showMessageBody(model), true);
  });
});
