import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LandingTarget } from '../machine/openState';
import { isPlaced, placementPlan } from '../list/placement';
import type { ChatRow } from '../model/chatRow.types';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch-1',
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

const rows: readonly ChatRow[] = buildRows(
  [
    input(),
    input({ conversationId: 'c2', createdAt: DAY + 2000, markdown: 'later', messageId: 'm2' }),
  ],
  {
    channelId: 'ch-1',
    channelKind: 'channel',
    currentUserId: 'me',
    unreadBoundaryAt: DAY + 1000,
  },
);

describe('placementPlan', (): void => {
  it('uses declarative end for a first-mount tail', (): void => {
    assert.deepEqual(placementPlan(rows, { kind: 'tail' }, true, false, true), {
      mode: 'declarative',
      initialScrollAtEnd: true,
    });
  });

  it('packs at the last message whether or not an unread divider is in the rows', (): void => {
    const withoutDivider = rows.filter(row => row.type !== 'unread-divider');
    assert.ok(rows.some(row => row.type === 'unread-divider'));
    assert.equal(withoutDivider.length, rows.length - 1);
    assert.deepEqual(
      placementPlan(withoutDivider, { kind: 'tail' }, true, false, true),
      placementPlan(rows, { kind: 'tail' }, true, false, true),
    );
  });

  it('uses declarative index when the target row is present on first mount', (): void => {
    const target: LandingTarget = {
      kind: 'anchor',
      conversationId: 'c2',
      messageId: 'm2',
      createdAt: DAY + 2000,
    };
    const plan = placementPlan(rows, target, true, false, true);
    assert.equal(plan.mode, 'declarative');
    if (plan.mode === 'declarative' && 'initialScrollIndex' in plan) {
      assert.equal(plan.initialScrollIndex.viewPosition, 0.35);
    }
  });

  it('uses imperative scroll only for reanchor', (): void => {
    const target: LandingTarget = {
      kind: 'anchor',
      conversationId: 'c2',
      messageId: 'm2',
      createdAt: DAY + 2000,
    };
    const plan = placementPlan(rows, target, false, true, true);
    assert.equal(plan.mode, 'imperative');
  });

  it('does not invent a plan before the landing target exists', (): void => {
    assert.deepEqual(placementPlan(rows, null, true, false, true), { mode: 'none' });
  });

  it('does not invent a plan when the row is missing', (): void => {
    const target: LandingTarget = {
      kind: 'anchor',
      conversationId: 'missing',
      messageId: 'missing',
      createdAt: 1,
    };
    assert.deepEqual(placementPlan(rows, target, true, false, true), { mode: 'none' });
  });
});

describe('isPlaced', (): void => {
  const tail: LandingTarget = { kind: 'tail' };
  const anchor: LandingTarget = {
    kind: 'anchor',
    conversationId: 'c1',
    messageId: 'm1',
    createdAt: DAY,
  };

  it('tail is placed only when ready and at end', (): void => {
    assert.equal(
      isPlaced(tail, { scroll: 0, scrollLength: 100, readyToRender: true, isAtEnd: true }),
      true,
    );
    assert.equal(
      isPlaced(tail, { scroll: 0, scrollLength: 100, readyToRender: true, isAtEnd: false }),
      false,
    );
  });

  it('does not treat overscan range as placed — position must match viewPosition', (): void => {
    const snapshot = {
      position: 10,
      scroll: 0,
      scrollLength: 100,
      readyToRender: true,
      isAtEnd: false,
    };
    assert.equal(isPlaced(anchor, snapshot), false);
    assert.equal(isPlaced(anchor, { ...snapshot, position: 35 }), true);
  });
});
