import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ROW_CATALOG } from '../parity/rowCatalog';
import { buildRows } from '../model/buildRows';
import { measureRowHeight } from '../model/measureRowHeight';

describe('v3 row catalog (P3)', (): void => {
  it('covers the parity row kinds', (): void => {
    assert.deepEqual(
      ROW_CATALOG.map(entry => entry.id),
      [
        'text-other-channel',
        'text-own-channel',
        'text-other-dm',
        'text-own-dm',
        'long-collapsed',
        'emoji-only',
        'media-image',
        'media-video',
        'media-file',
        'media-mixed',
        'ticket',
        'ticket-activity',
        'flow-json',
        'forwarded',
        'system',
        'call-message',
        'non-participant-system',
        'bot',
        'deleted',
        'with-reactions',
        'with-replies',
        'with-parent-preview',
        'link-preview',
        'pinned-bookmarked-edited',
      ],
    );
  });

  it('buildRows + measureRowHeight stay stable for every catalog fixture', (): void => {
    for (const entry of ROW_CATALOG) {
      const rows = buildRows([entry.input], {
        channelId: entry.input.channelId,
        channelKind: entry.channelKind,
        currentUserId: entry.currentUserId,
      });
      const message = rows.find(row => row.type === 'message');
      assert.ok(message, entry.id);
      if (message?.type !== 'message') continue;
      const model = message.model;
      assert.equal(model.rowKind, entry.expected.rowKind, entry.id);
      assert.equal(model.rowType, entry.expected.rowType, entry.id);
      if (entry.expected.isDeleted !== undefined) {
        assert.equal(model.isDeleted, entry.expected.isDeleted, entry.id);
      }
      if (entry.expected.isFlowJson !== undefined) {
        assert.equal(model.isFlowJson, entry.expected.isFlowJson, entry.id);
      }
      if (entry.expected.isCall !== undefined) {
        assert.equal(model.isCall, entry.expected.isCall, entry.id);
      }
      if (entry.expected.hasNonParticipantPreview !== undefined) {
        assert.equal(
          model.nonParticipantPreview !== null,
          entry.expected.hasNonParticipantPreview,
          entry.id,
        );
      }
      if (entry.expected.hasReactions) {
        assert.ok((model.reactionPreview?.totalCount ?? 0) > 0, entry.id);
      }
      if (entry.expected.hasReplies) {
        assert.ok((model.replyPreview?.count ?? 0) > 0, entry.id);
      }
      if (entry.expected.hasParentPreview) {
        assert.ok(model.parentPreview, entry.id);
      }
      if (entry.expected.hasLinkPreview) {
        assert.ok(model.linkPreview, entry.id);
      }
      if (entry.expected.isPinned !== undefined) {
        assert.equal(model.isPinned, entry.expected.isPinned, entry.id);
      }
      if (entry.expected.isBookmarked !== undefined) {
        assert.equal(model.isBookmarked, entry.expected.isBookmarked, entry.id);
      }
      if (entry.expected.isEdited !== undefined) {
        assert.equal(model.isEdited, entry.expected.isEdited, entry.id);
      }
      const height = measureRowHeight(message);
      assert.ok(height > 0 && Number.isFinite(height), entry.id);
    }
  });
});
