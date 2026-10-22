import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMentionMarkdownLink,
  ensureSpacesBetweenMentionLinks,
  ensureSpacesBetweenMentionSpans,
  userMentionLabelFromSpan,
  channelMentionLabelFromSpan,
  groupMentionLabelFromSpan,
} from '@/src/utils/mentionHtmlToMarkdown';

// ─── formatMentionMarkdownLink ──────────────────────────────────────────────

test('formatMentionMarkdownLink: builds a standard markdown link', () => {
  assert.equal(formatMentionMarkdownLink('@Aryan', 'xyne://user/1'), '[@Aryan](xyne://user/1)');
});

test('formatMentionMarkdownLink: escapes closing brackets and strips backticks in the label', () => {
  assert.equal(formatMentionMarkdownLink('a]b', 'u'), '[a\\]b](u)');
  assert.equal(formatMentionMarkdownLink('a`b`c', 'u'), '[abc](u)');
});

test('formatMentionMarkdownLink: escapes a backslash so it cannot swallow the closing bracket', () => {
  assert.equal(formatMentionMarkdownLink('@John\\', 'u'), '[@John\\\\](u)');
});

// ─── ensureSpacesBetweenMentionLinks ────────────────────────────────────────

test('ensureSpacesBetweenMentionLinks: empty input is returned unchanged', () => {
  assert.equal(ensureSpacesBetweenMentionLinks(''), '');
});

test('ensureSpacesBetweenMentionLinks: inserts a space between flush xyne mention links', () => {
  assert.equal(
    ensureSpacesBetweenMentionLinks('[@A](xyne://user/1)[@B](xyne://user/2)'),
    '[@A](xyne://user/1) [@B](xyne://user/2)',
  );
});

test('ensureSpacesBetweenMentionLinks: normalizes a comma directly before a mention link', () => {
  assert.equal(
    ensureSpacesBetweenMentionLinks('[@A](xyne://user/1),[@B](xyne://user/2)'),
    '[@A](xyne://user/1), [@B](xyne://user/2)',
  );
});

test('ensureSpacesBetweenMentionLinks: leaves non-xyne links untouched', () => {
  const input = '[x](https://a.com)[y](https://b.com)';
  assert.equal(ensureSpacesBetweenMentionLinks(input), input);
});

// ─── ensureSpacesBetweenMentionSpans ────────────────────────────────────────

test('ensureSpacesBetweenMentionSpans: empty input is returned unchanged', () => {
  assert.equal(ensureSpacesBetweenMentionSpans(''), '');
});

test('ensureSpacesBetweenMentionSpans: inserts &nbsp; between back-to-back mention spans', () => {
  assert.equal(
    ensureSpacesBetweenMentionSpans(
      '<span data-mention="1">@A</span><span data-mention="2">@B</span>',
    ),
    '<span data-mention="1">@A</span>&nbsp;<span data-mention="2">@B</span>',
  );
});

test('ensureSpacesBetweenMentionSpans: leaves ordinary adjacent spans untouched', () => {
  const input = '<span class="x">a</span><span class="y">b</span>';
  assert.equal(ensureSpacesBetweenMentionSpans(input), input);
});

// ─── userMentionLabelFromSpan ───────────────────────────────────────────────

test('userMentionLabelFromSpan: prefers the longer of attribute vs inner text, prefixed with @', () => {
  assert.equal(userMentionLabelFromSpan('data-username="Aryan Kumar"', '@Aryan'), '@Aryan Kumar');
});

test('userMentionLabelFromSpan: falls back to inner text when attribute is absent', () => {
  assert.equal(userMentionLabelFromSpan('', '@Bob'), '@Bob');
});

test('userMentionLabelFromSpan: decodes HTML entities in the attribute', () => {
  assert.equal(userMentionLabelFromSpan('data-username="A&amp;B"', ''), '@A&B');
});

// ─── channelMentionLabelFromSpan ────────────────────────────────────────────

test('channelMentionLabelFromSpan: prefixes with # and picks the longer name', () => {
  assert.equal(channelMentionLabelFromSpan('data-channel-name="general"', '#gen'), '#general');
});

// ─── groupMentionLabelFromSpan ──────────────────────────────────────────────

test('groupMentionLabelFromSpan: prefers alias over name', () => {
  assert.equal(
    groupMentionLabelFromSpan('data-group-alias="team" data-group-name="Team Name"', ''),
    '@team',
  );
});

test('groupMentionLabelFromSpan: falls back to group name when alias is absent', () => {
  assert.equal(groupMentionLabelFromSpan('data-group-name="Team Name"', ''), '@Team Name');
});
