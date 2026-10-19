import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatMentionDisplay,
  normalizeInterMentionWhitespaceForEdit,
  normalizeMentionName,
  resolveChannelMentionName,
  resolveGroupMentionName,
  resolveUserMentionName,
  resolveUserMentionNameFromNativeAttrs,
  stripLeadingMentionPrefix,
} from '@/src/utils/mentionLabelUtils';

describe('stripLeadingMentionPrefix', () => {
  it('removes repeated leading @ and trims', () => {
    assert.equal(stripLeadingMentionPrefix('@@Alice'), 'Alice');
    assert.equal(stripLeadingMentionPrefix('  @Bob '), 'Bob');
  });

  it('removes leading # when indicator is #', () => {
    assert.equal(stripLeadingMentionPrefix('#general', '#'), 'general');
  });

  it('does not strip the other indicator', () => {
    assert.equal(stripLeadingMentionPrefix('#room', '@'), '#room');
  });

  it('returns empty string for blank or indicator-only input', () => {
    assert.equal(stripLeadingMentionPrefix(''), '');
    assert.equal(stripLeadingMentionPrefix('@'), '');
  });
});

describe('formatMentionDisplay', () => {
  it('prepends exactly one indicator', () => {
    assert.equal(formatMentionDisplay('Alice'), '@Alice');
    assert.equal(formatMentionDisplay('@@Bob'), '@Bob');
    assert.equal(formatMentionDisplay('gen', '#'), '#gen');
  });

  it('returns the bare indicator when the name is empty', () => {
    assert.equal(formatMentionDisplay('', '@'), '@');
  });
});

describe('normalizeMentionName', () => {
  it('strips the indicator prefix for storage', () => {
    assert.equal(normalizeMentionName('@Carol'), 'Carol');
    assert.equal(normalizeMentionName('#chan', '#'), 'chan');
  });
});

describe('resolveUserMentionName', () => {
  it('falls back to the attribute when inner text is empty', () => {
    assert.equal(resolveUserMentionName('@alice', ''), 'alice');
  });

  it('falls back to inner text when the attribute is empty', () => {
    assert.equal(resolveUserMentionName('', '@bob'), 'bob');
  });

  it('prefers the longer of the two candidates (inner wins ties)', () => {
    assert.equal(resolveUserMentionName('@al', '@alice'), 'alice');
    assert.equal(resolveUserMentionName('@alexander', '@bob'), 'alexander');
  });
});

describe('resolveChannelMentionName', () => {
  it('strips # and prefers inner text when present', () => {
    assert.equal(resolveChannelMentionName('#general', ''), 'general');
    assert.equal(resolveChannelMentionName('#g', '#general'), 'general');
  });
});

describe('resolveGroupMentionName', () => {
  it('uses alias over name when inner text is empty', () => {
    assert.equal(resolveGroupMentionName('Alias', 'Name', ''), 'Alias');
  });

  it('falls back to name when alias is empty', () => {
    assert.equal(resolveGroupMentionName('', 'Team', ''), 'Team');
  });
});

describe('resolveUserMentionNameFromNativeAttrs', () => {
  it('prefers data-username, then username, then text, then inner content', () => {
    assert.equal(resolveUserMentionNameFromNativeAttrs({ 'data-username': '@x' }, 'inner'), 'x');
    assert.equal(resolveUserMentionNameFromNativeAttrs({ username: '@z' }, ''), 'z');
    assert.equal(resolveUserMentionNameFromNativeAttrs({}, '  @y '), 'y');
  });
});

describe('normalizeInterMentionWhitespaceForEdit', () => {
  it('collapses &nbsp; and NBSP between adjacent mention tags to a single space', () => {
    assert.equal(normalizeInterMentionWhitespaceForEdit('</span>&nbsp;<span>'), '</span> <span>');
    assert.equal(
      normalizeInterMentionWhitespaceForEdit('</mention>\u00a0<mention>'),
      '</mention> <mention>',
    );
  });

  it('leaves non-whitespace content untouched', () => {
    assert.equal(normalizeInterMentionWhitespaceForEdit('</span>text<span>'), '</span>text<span>');
    assert.equal(normalizeInterMentionWhitespaceForEdit(''), '');
  });
});
