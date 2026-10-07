import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePreviewMd,
  parseXPostPreviewMd,
  serializeXPostPreviewMd,
  serializeLinkPreviewMd,
} from '../dist/utils/linkPreviewParser.js';

const base = {
  url: 'https://x.com/jack/status/20',
  postId: '20',
  authorName: 'jack',
  authorHandle: 'jack',
  text: 'just setting up my twttr',
  tldrStatus: 'skipped',
};

test('round-trips an X post card, including multi-line text and colons', () => {
  const card = {
    ...base,
    text: 'Line one: has a colon\nLine two \\ with a backslash\n:::\nnot a terminator',
    createdAt: '2006-03-21T20:50:14.000Z',
    tldr: 'Summary: it works.',
    tldrStatus: 'ready',
  };
  const md = serializeXPostPreviewMd(card);
  assert.deepEqual(parseXPostPreviewMd(md), card);
});

test('parsePreviewMd routes the block to x_post_preview, not link_preview', () => {
  const result = parsePreviewMd(serializeXPostPreviewMd(base));
  assert.equal(result?.type, 'x_post_preview');
  assert.equal(result?.data.postId, '20');
});

test('ordinary link previews are unaffected', () => {
  const md = serializeLinkPreviewMd({ url: 'https://example.com', title: 'Example' });
  assert.equal(parsePreviewMd(md)?.type, 'link_preview');
});

test('unknown tldrStatus degrades to skipped', () => {
  const md = serializeXPostPreviewMd(base).replace('tldrStatus: skipped', 'tldrStatus: exploding');
  assert.equal(parseXPostPreviewMd(md)?.tldrStatus, 'skipped');
});

test('requires url and postId', () => {
  assert.equal(serializeXPostPreviewMd({ ...base, postId: '' }), null);
  assert.equal(parseXPostPreviewMd(':::x_post_preview\nurl: https://x.com/a/status/1\n:::'), null);
});
