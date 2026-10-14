import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getConversationReactionsMd } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationReactionsMd';

type ConversationArg = Parameters<typeof getConversationReactionsMd>[0];

const asConversation = (value: unknown): ConversationArg => value as ConversationArg;

describe('getConversationReactionsMd', () => {
  it('returns null for null or undefined conversations', () => {
    assert.equal(getConversationReactionsMd(null), null);
    assert.equal(getConversationReactionsMd(undefined), null);
  });

  it('falls back to the top-level reactions_md string', () => {
    assert.equal(
      getConversationReactionsMd(asConversation({ reactions_md: '👍 3 ❤️ 1' })),
      '👍 3 ❤️ 1',
    );
  });

  it('ignores a non-string reactions_md value', () => {
    assert.equal(getConversationReactionsMd(asConversation({ reactions_md: 123 })), null);
    assert.equal(getConversationReactionsMd(asConversation({ reactions_md: null })), null);
  });

  it('returns null when no reactions metadata is present', () => {
    assert.equal(getConversationReactionsMd(asConversation({})), null);
  });
});
