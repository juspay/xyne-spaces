import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMentionLinkVariants,
  mentionFromUrl,
  resolveMentionColors,
  type MentionPalette,
} from '../model/mentionPresentation';

const palette: MentionPalette = {
  otherBg: 'other-bg',
  otherText: 'other-text',
  currentOtherBg: 'current-other-bg',
  currentOtherText: 'current-other-text',
  mentionedYouBg: 'yellow',
  mentionedYouText: 'yellow-text',
  currentSelfBg: 'current-yellow',
  currentSelfText: 'current-yellow-text',
};

describe('mention presentation parity', (): void => {
  it('highlights self and broadcast mentions that target the viewer', (): void => {
    assert.deepEqual(
      resolveMentionColors({
        mentionKind: 'user',
        mentionId: 'me',
        palette,
        viewerId: 'me',
        isOwnMessage: false,
      }),
      { backgroundColor: 'yellow', color: 'yellow-text' },
    );
    assert.deepEqual(
      resolveMentionColors({
        mentionKind: 'broadcast',
        mentionId: 'here',
        palette,
        viewerId: 'me',
        isOwnMessage: false,
      }),
      { backgroundColor: 'yellow', color: 'yellow-text' },
    );
  });

  it('uses the quieter own-message palette for mentions authored by the viewer', (): void => {
    assert.deepEqual(
      resolveMentionColors({
        mentionKind: 'user',
        mentionId: 'me',
        palette,
        viewerId: 'me',
        isOwnMessage: true,
      }),
      { backgroundColor: 'current-yellow', color: 'current-yellow-text' },
    );
    assert.deepEqual(
      resolveMentionColors({
        mentionKind: 'user',
        mentionId: 'other',
        palette,
        viewerId: 'me',
        isOwnMessage: true,
      }),
      { backgroundColor: 'current-other-bg', color: 'current-other-text' },
    );
  });

  it('styles raw and encoded viewer ids in native block markdown', (): void => {
    const variants = buildMentionLinkVariants({
      palette,
      viewerId: 'user/one',
      isOwnMessage: false,
    });
    const keys = Object.keys(variants);
    assert.equal(
      keys.some(key => key.includes('user/one')),
      true,
    );
    assert.equal(
      keys.some(key => key.includes('user%2Fone')),
      true,
    );
    assert.equal(
      keys.some(key => key.includes('broadcast')),
      true,
    );
  });

  it('decodes encoded mention ids from the same schemes the renderer taps', (): void => {
    assert.deepEqual(mentionFromUrl('xyne://user/me'), {
      mentionKind: 'user',
      mentionId: 'me',
    });
    assert.deepEqual(mentionFromUrl('xyne://user/user%2Fone'), {
      mentionKind: 'user',
      mentionId: 'user/one',
    });
    assert.deepEqual(mentionFromUrl('xyne://broadcast/here'), {
      mentionKind: 'broadcast',
      mentionId: 'here',
    });
    assert.equal(mentionFromUrl('https://example.com'), null);
  });
});
