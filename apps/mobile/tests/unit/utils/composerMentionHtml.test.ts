import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countComposerMentions,
  countSpecialMentionTypeAttrs,
} from '@/src/utils/composerMentionHtml';

describe('countComposerMentions', () => {
  it('returns 0 when there are no mention tags', () => {
    assert.equal(countComposerMentions(''), 0);
    assert.equal(countComposerMentions('no mentions here'), 0);
  });

  it('counts only opening <mention> tags, not closing tags', () => {
    assert.equal(
      countComposerMentions('<mention data-username="a">a</mention><mention>b</mention>'),
      2,
    );
  });

  it('is case-insensitive', () => {
    assert.equal(countComposerMentions('<MENTION>x</MENTION>'), 1);
  });
});

describe('countSpecialMentionTypeAttrs', () => {
  it('counts channel and here broadcast metadata', () => {
    const html =
      '<mention data-mention-type="channel"></mention> <mention data-mention-type="here"></mention>';
    assert.equal(countSpecialMentionTypeAttrs(html), 2);
  });

  it('ignores non-broadcast mention types', () => {
    assert.equal(countSpecialMentionTypeAttrs('<mention data-mention-type="user"></mention>'), 0);
    assert.equal(countSpecialMentionTypeAttrs(''), 0);
  });

  it('accepts single-quoted attribute values', () => {
    assert.equal(countSpecialMentionTypeAttrs("<mention data-mention-type='channel'>"), 1);
  });
});
