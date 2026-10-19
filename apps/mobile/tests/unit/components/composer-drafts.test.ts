import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearDraft,
  findZeroDraftForComposer,
  getDraft,
  getDraftFlushContent,
  isDraftEmpty,
  setDraft,
  shouldClearLocalDraftForRemoteDelete,
  shouldKeepRemoteDraftAfterComposerClear,
  canMarkChannelAsViewed,
  claimRemoteUserDraftDelete,
} from '@/src/components/input-composer/utils/drafts';

describe('composer drafts store', () => {
  it('returns an empty draft for an id that was never set', () => {
    assert.deepEqual(getDraft('drafts-test-unset'), { text: '', html: '' });
  });

  it('round-trips a saved draft', () => {
    const id = 'drafts-test-roundtrip';
    setDraft(id, { text: 'hi', html: '<p>hi</p>' });
    assert.deepEqual(getDraft(id), { text: 'hi', html: '<p>hi</p>' });
    clearDraft(id);
  });

  it('persists a draft that only has text', () => {
    const id = 'drafts-test-text-only';
    setDraft(id, { text: 'x', html: '' });
    assert.deepEqual(getDraft(id), { text: 'x', html: '' });
    clearDraft(id);
  });

  it('clearing a draft resets it to empty', () => {
    const id = 'drafts-test-clear';
    setDraft(id, { text: 'bye', html: '<p>bye</p>' });
    clearDraft(id);
    assert.deepEqual(getDraft(id), { text: '', html: '' });
  });

  it('treats an empty save as a removal', () => {
    const id = 'drafts-test-empty-save';
    setDraft(id, { text: 'temp', html: '<p>temp</p>' });
    setDraft(id, { text: '', html: '' });
    assert.deepEqual(getDraft(id), { text: '', html: '' });
  });

  it('flush content prefers html, then text, then fallback', () => {
    const id = 'drafts-test-flush';
    assert.equal(getDraftFlushContent(id, 'keep-me'), 'keep-me');
    setDraft(id, { text: 'plain', html: '' });
    assert.equal(getDraftFlushContent(id, 'keep-me'), 'plain');
    setDraft(id, { text: 'plain', html: '<p>rich</p>' });
    assert.equal(getDraftFlushContent(id, 'keep-me'), '<p>rich</p>');
    clearDraft(id);
  });

  it('treats empty HTML shells as empty and does not restore Zero after a clear', () => {
    assert.equal(isDraftEmpty({ text: '', html: '<p></p>' }), true);
    assert.equal(isDraftEmpty({ text: '', html: '<html>\n</html>' }), true);
    assert.equal(isDraftEmpty({ text: '', html: '<p>hi</p>' }), false);
    const id = 'drafts-test-flush-shell';
    setDraft(id, { text: 'keep', html: '<p>keep</p>' });
    setDraft(id, { text: '', html: '<p><br></p>' });
    assert.equal(getDraftFlushContent(id, 'from-zero'), '');
    clearDraft(id);
  });

  it('still uses the Zero fallback when a draft was never opened locally', () => {
    assert.equal(getDraftFlushContent('drafts-test-never-opened', 'from-zero'), 'from-zero');
  });
});

describe('findZeroDraftForComposer', () => {
  it('matches channel drafts vs thread drafts', () => {
    const rows = [
      { channelId: 'c1', conversationId: 't1', content: 'thread' },
      { channelId: 'c1', conversationId: null, content: 'channel' },
    ];
    assert.equal(findZeroDraftForComposer(rows, 'c1', undefined)?.content, 'channel');
    assert.equal(findZeroDraftForComposer(rows, 'c1', 't1')?.content, 'thread');
  });

  it('treats empty conversationId as a channel draft', () => {
    const rows = [{ channelId: 'c1', conversationId: '', content: 'channel' }];
    assert.equal(findZeroDraftForComposer(rows, 'c1', undefined)?.content, 'channel');
  });

  it('skips Twin rows so a thread can keep a separate user draft', () => {
    const rows = [
      {
        channelId: 'c1',
        conversationId: 't1',
        content: 'twin body',
        origin: 'twin' as const,
      },
      {
        channelId: 'c1',
        conversationId: 't1',
        content: 'user body',
      },
    ];
    assert.equal(findZeroDraftForComposer(rows, 'c1', 't1')?.content, 'user body');
    assert.equal(findZeroDraftForComposer(rows.slice(0, 1), 'c1', 't1'), undefined);
  });
});

describe('shouldClearLocalDraftForRemoteDelete', () => {
  it('clears cached local text when Zero no longer has the draft', () => {
    assert.equal(
      shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: true,
        hasRemoteDraft: false,
        composerDirty: false,
        localEmpty: false,
        hasAppliedRemoteDraft: true,
      }),
      true,
    );
  });

  it('keeps local text while the user is still typing', () => {
    assert.equal(
      shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: true,
        hasRemoteDraft: false,
        composerDirty: true,
        localEmpty: false,
        hasAppliedRemoteDraft: true,
      }),
      false,
    );
  });

  it('does not clear when a remote draft still exists', () => {
    assert.equal(
      shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: true,
        hasRemoteDraft: true,
        composerDirty: false,
        localEmpty: false,
        hasAppliedRemoteDraft: true,
      }),
      false,
    );
  });

  it('does not clear before Zero has finished loading', () => {
    assert.equal(
      shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: false,
        hasRemoteDraft: false,
        composerDirty: false,
        localEmpty: false,
        hasAppliedRemoteDraft: false,
      }),
      false,
    );
  });

  it('does not clear a local MMKV draft just because Zero never had one', () => {
    assert.equal(
      shouldClearLocalDraftForRemoteDelete({
        remoteQueryComplete: true,
        hasRemoteDraft: false,
        composerDirty: false,
        localEmpty: false,
        hasAppliedRemoteDraft: false,
      }),
      false,
    );
  });
});

describe('shouldKeepRemoteDraftAfterComposerClear', () => {
  it('deletes a text draft even when hasAttachment is a ghost flag', () => {
    assert.equal(
      shouldKeepRemoteDraftAfterComposerClear({
        composerHasAttachments: false,
        remoteAttachmentCount: 0,
      }),
      false,
    );
  });

  it('keeps the row when the composer still has files', () => {
    assert.equal(
      shouldKeepRemoteDraftAfterComposerClear({
        composerHasAttachments: true,
        remoteAttachmentCount: 0,
      }),
      true,
    );
  });

  it('keeps the row when Zero still has attachment files', () => {
    assert.equal(
      shouldKeepRemoteDraftAfterComposerClear({
        composerHasAttachments: false,
        remoteAttachmentCount: 2,
      }),
      true,
    );
  });
});

describe('canMarkChannelAsViewed', () => {
  it('is false without a membership row so leave does not throw', () => {
    assert.equal(canMarkChannelAsViewed(undefined), false);
    assert.equal(canMarkChannelAsViewed(null), false);
    assert.equal(canMarkChannelAsViewed({ isDeleted: true }), false);
  });

  it('is true for an active participant', () => {
    assert.equal(canMarkChannelAsViewed({}), true);
    assert.equal(canMarkChannelAsViewed({ isDeleted: false }), true);
  });
});

describe('claimRemoteUserDraftDelete', () => {
  it('allows a user or legacy null-origin row once', () => {
    assert.equal(claimRemoteUserDraftDelete({ id: 'd-user', origin: 'user' }), 'd-user');
    assert.equal(claimRemoteUserDraftDelete({ id: 'd-user', origin: 'user' }), undefined);
    assert.equal(claimRemoteUserDraftDelete({ id: 'd-legacy' }), 'd-legacy');
  });

  it('does not delete Twin rows', () => {
    assert.equal(claimRemoteUserDraftDelete({ id: 'd-twin', origin: 'twin' }), undefined);
  });

  it('skips rows without an id', () => {
    assert.equal(claimRemoteUserDraftDelete({ origin: 'user' }), undefined);
    assert.equal(claimRemoteUserDraftDelete({ id: '   ', origin: 'user' }), undefined);
  });
});
