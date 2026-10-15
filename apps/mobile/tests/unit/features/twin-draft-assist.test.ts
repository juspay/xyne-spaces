import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adjacentTwinDraftId,
  canEditTwinDraft,
  formatTwinIntentLabel,
  isTwinDockPending,
  resolveTwinSendUiTransition,
  selectTwinDraftForThread,
  shouldClearTwinEditOnDraftSuccess,
  shouldNavigateTwinPosted,
  twinDraftBodyPreview,
  twinDraftPagerLabel,
  twinDraftSendLabel,
  twinDraftsForThread,
  buildTwinApproveBody,
  shouldKeepTwinEditWhileDraftsReload,
} from '@/src/features/drafts-sent/twin-draft-assist';
import type { DraftMessageRow } from '@/src/features/drafts-sent/drafts-sent-utils';
import type { TwinReplyDraftView } from '@/src/features/drafts-sent/twin-draft-utils';

const view = (overrides: Partial<TwinReplyDraftView> & { id: string }): TwinReplyDraftView => ({
  channelId: 'ch-1',
  conversationId: 'thread-1',
  action: 'reply',
  destinationKind: 'origin_thread',
  createdAt: 1,
  ...overrides,
});

describe('twin draft assist', () => {
  it('filters Zero rows to the open thread', () => {
    const rows = [
      {
        id: 't1',
        channelId: 'ch-1',
        conversationId: 'thread-1',
        userId: 'u-1',
        content: '',
        hasAttachment: false,
        createdAt: 2,
        updatedAt: 2,
        origin: 'twin',
        metadata: JSON.stringify({ action: 'reply', message: 'hi', createdAt: 2 }),
      },
      {
        id: 't2',
        channelId: 'ch-1',
        conversationId: 'thread-2',
        userId: 'u-1',
        content: '',
        hasAttachment: false,
        createdAt: 3,
        updatedAt: 3,
        origin: 'twin',
        metadata: JSON.stringify({ action: 'reply', message: 'other', createdAt: 3 }),
      },
    ] as unknown as DraftMessageRow[];

    assert.deepEqual(
      twinDraftsForThread(rows, 'thread-1').map(item => item.id),
      ['t1'],
    );
  });

  it('selects the requested draft when it still exists', () => {
    const drafts = [view({ id: 'a', createdAt: 2 }), view({ id: 'b', createdAt: 1 })];
    assert.equal(selectTwinDraftForThread(drafts, 'b')?.id, 'b');
    assert.equal(selectTwinDraftForThread(drafts, 'gone')?.id, 'a');
    assert.equal(selectTwinDraftForThread([], 'a'), null);
  });

  it('pages between drafts and hides the pager for a single card', () => {
    const drafts = [view({ id: 'a' }), view({ id: 'b' }), view({ id: 'c' })];
    assert.equal(twinDraftPagerLabel(drafts, 'b'), '2/3');
    assert.equal(adjacentTwinDraftId(drafts, 'b', -1), 'a');
    assert.equal(adjacentTwinDraftId(drafts, 'b', 1), 'c');
    assert.equal(adjacentTwinDraftId(drafts, 'a', -1), null);
    assert.equal(twinDraftPagerLabel([view({ id: 'a' })], 'a'), null);
  });

  it('formats react vs reply intent and send labels', () => {
    assert.equal(
      formatTwinIntentLabel(view({ id: 'r', action: 'react', emoji: '👍' })),
      'React 👍',
    );
    assert.equal(formatTwinIntentLabel(view({ id: 'p' })), 'Reply in this thread');
    assert.equal(canEditTwinDraft(view({ id: 'r', action: 'react' })), false);
    assert.equal(canEditTwinDraft(view({ id: 'p' })), true);
    assert.equal(twinDraftSendLabel(view({ id: 'r', action: 'react' })), 'Send reaction');
    assert.equal(twinDraftBodyPreview(view({ id: 'p', message: 'Thanks' })), 'Thanks');
  });

  it('navigates only when approve posted a different thread', () => {
    assert.equal(
      shouldNavigateTwinPosted(
        { channelId: 'ch-1', conversationId: 'thread-1' },
        { channelId: 'ch-1', conversationId: 'thread-1' },
      ),
      false,
    );
    assert.equal(
      shouldNavigateTwinPosted(
        { channelId: 'ch-1', conversationId: 'thread-1' },
        { channelId: 'ch-1', conversationId: 'dm-9' },
      ),
      true,
    );
  });

  it('omits editedMessage when empty or unchanged', () => {
    assert.deepEqual(buildTwinApproveBody('  ', 'Hello'), {});
    assert.deepEqual(buildTwinApproveBody('Hello', 'Hello'), {});
    assert.deepEqual(buildTwinApproveBody('Hello there', 'Hello'), {
      editedMessage: 'Hello there',
    });
  });

  it('omits editedMessage when HTML edit matches the plain Twin original', () => {
    const original = 'Hello\n\nWorld';
    const fromComposer = '<p>Hello</p><p></p><p>World</p>';
    assert.deepEqual(buildTwinApproveBody(fromComposer, original), {});
    assert.deepEqual(buildTwinApproveBody('<p>Hello</p><p></p><p>World!</p>', original), {
      editedMessage: '<p>Hello</p><p></p><p>World!</p>',
    });
  });

  it('keeps Twin-edit across an empty Zero reload and exits when the row is gone', () => {
    assert.equal(shouldKeepTwinEditWhileDraftsReload('a', []), true);
    assert.equal(shouldKeepTwinEditWhileDraftsReload('a', [view({ id: 'a' })]), true);
    assert.equal(shouldKeepTwinEditWhileDraftsReload('a', [view({ id: 'b' })]), false);
    assert.equal(shouldKeepTwinEditWhileDraftsReload(null, []), false);
  });

  it('gates the next draft while a prior send is still in flight', () => {
    // Optimistic hide of A surfaces B immediately; pending must still lock the dock.
    const pending = new Set<string>(['a']);
    const remaining = [view({ id: 'b', createdAt: 1 })];
    const selected = selectTwinDraftForThread(remaining, null);
    assert.equal(selected?.id, 'b');
    // Per-id check would wrongly unlock B:
    assert.equal(pending.has(selected!.id), false);
    assert.equal(isTwinDockPending(pending), true);

    pending.delete('a');
    assert.equal(isTwinDockPending(pending), false);

    // Completing A must not tear down an active twin-edit on B.
    assert.equal(shouldClearTwinEditOnDraftSuccess('b', 'a'), false);
    assert.equal(shouldClearTwinEditOnDraftSuccess('a', 'a'), true);
    // Dock Send with no twin-edit: leave composer alone.
    assert.equal(shouldClearTwinEditOnDraftSuccess(null, 'a'), false);
  });
});

describe('resolveTwinSendUiTransition', () => {
  it('ends twin-edit on edit-send success even when editingDraftId lagged to null', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: true,
        editingDraftId: null,
        draftId: 'a',
        outcome: 'success',
      }),
      { endTwinEdit: true, undismiss: false, restoreEditingDraftId: false },
    );
  });

  it('ends twin-edit on edit-send 404/gone without undismissing', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: true,
        editingDraftId: 'a',
        draftId: 'a',
        outcome: 'gone',
      }),
      { endTwinEdit: true, undismiss: false, restoreEditingDraftId: false },
    );
  });

  it('undismisses and restores edit session on delivery failure for retry', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: true,
        editingDraftId: 'a',
        draftId: 'a',
        outcome: 'delivery_error',
      }),
      { endTwinEdit: false, undismiss: true, restoreEditingDraftId: true },
    );
  });

  it('undismisses dock send failures without touching twin-edit', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: false,
        editingDraftId: null,
        draftId: 'a',
        outcome: 'error',
      }),
      { endTwinEdit: false, undismiss: true, restoreEditingDraftId: false },
    );
  });

  it('leaves twin-edit alone on normal dock send success', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: false,
        editingDraftId: null,
        draftId: 'a',
        outcome: 'success',
      }),
      { endTwinEdit: false, undismiss: false, restoreEditingDraftId: false },
    );
  });

  it('clears twin-edit on dock send success only when the completed id is being edited', () => {
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: false,
        editingDraftId: 'a',
        draftId: 'a',
        outcome: 'success',
      }),
      { endTwinEdit: true, undismiss: false, restoreEditingDraftId: false },
    );
    assert.deepEqual(
      resolveTwinSendUiTransition({
        preserveTwinEdit: false,
        editingDraftId: 'b',
        draftId: 'a',
        outcome: 'success',
      }),
      { endTwinEdit: false, undismiss: false, restoreEditingDraftId: false },
    );
  });
});
