import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { overlayReducer, EMPTY_OVERLAYS } from '../overlays/overlayReducer';
import type { MessageActionsTarget } from '../overlays/MessageActionsHost';
import type { ChatMessageRow } from '../model/chatRow.types';

const row = {
  type: 'message',
  id: 'c1',
  model: {
    conversationId: 'c1',
    messageId: 'm1',
    channelId: 'ch',
    body: { markdown: 'hi', plainText: 'hi' },
    sender: { senderId: 'u1', displayName: 'Ada' },
  },
} as unknown as ChatMessageRow;

const target: MessageActionsTarget = {
  row,
  html: 'hi',
  attachments: [],
  reactionsMd: null,
};

describe('overlayReducer', (): void => {
  it('opens forward without dropping the target (B1)', (): void => {
    const actions = overlayReducer(EMPTY_OVERLAYS, { type: 'openActions', target });
    const forward = overlayReducer(actions, { type: 'openForward', target });
    assert.equal(forward.sheet.kind, 'forward');
    if (forward.sheet.kind === 'forward') {
      assert.equal(forward.sheet.target, target);
    }
    assert.equal(forward.editing, null);
  });

  it('startEdit closes the sheet and keeps editing (M16)', (): void => {
    const actions = overlayReducer(EMPTY_OVERLAYS, { type: 'openActions', target });
    const editing = overlayReducer(actions, {
      type: 'startEdit',
      payload: { messageId: 'm1', conversationId: 'c1', channelId: 'ch', content: 'hi' },
    });
    assert.equal(editing.sheet.kind, 'closed');
    assert.equal(editing.editing?.messageId, 'm1');
  });

  it('opening a sheet does not cancel an in-progress edit', (): void => {
    const editing = overlayReducer(EMPTY_OVERLAYS, {
      type: 'startEdit',
      payload: { messageId: 'm1', conversationId: 'c1', channelId: 'ch', content: 'hi' },
    });
    const profile = overlayReducer(editing, {
      type: 'openProfile',
      target: { userId: 'u1', displayName: 'Ada' },
    });
    assert.equal(profile.editing?.messageId, 'm1');
    assert.equal(profile.sheet.kind, 'profile');
  });
});
