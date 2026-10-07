import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose (see agentCardFlowSchema.test.mjs).
import {
  parseXPostPreviewMd,
  serializeXPostPreviewMd,
  parsePreviewMd,
} from '../dist/utils/linkPreviewParser.js';

const base = {
  url: 'https://x.com/jack/status/20',
  postId: '20',
  author: 'jack',
  authorUrl: 'https://twitter.com/jack',
  text: 'line one\nline two with a back\\slash and key: value',
  tldr: 'A short summary.',
  tldrStatus: 'ready',
};

test('x_post_preview round-trips through serialize/parse', () => {
  const md = serializeXPostPreviewMd(base);
  assert.ok(md.startsWith(':::x_post_preview'));
  assert.deepEqual(parseXPostPreviewMd(md), base);
});

test('multi-line post text cannot break out of the block', () => {
  const evil = { ...base, text: 'hi\n:::\n:::link_preview\nurl: https://evil.example\n:::' };
  const parsed = parseXPostPreviewMd(serializeXPostPreviewMd(evil));
  assert.equal(parsed.text, evil.text);
  assert.equal(parsePreviewMd(serializeXPostPreviewMd(evil)).type, 'x_post_preview');
});

test('parsePreviewMd dispatches x_post_preview', () => {
  const res = parsePreviewMd(serializeXPostPreviewMd({ ...base, tldrStatus: 'pending', tldr: undefined }));
  assert.equal(res.type, 'x_post_preview');
  assert.equal(res.data.tldrStatus, 'pending');
  assert.equal(res.data.tldr, undefined);
});

test('unknown tldrStatus degrades to skipped; unavailable flag round-trips', () => {
  const md = ':::x_post_preview\nurl: https://x.com/a/status/1\npostId: 1\ntldrStatus: banana\nunavailable: true\n:::';
  const parsed = parseXPostPreviewMd(md);
  assert.equal(parsed.tldrStatus, 'skipped');
  assert.equal(parsed.unavailable, true);
});

test('missing url or postId yields null', () => {
  assert.equal(parseXPostPreviewMd(':::x_post_preview\nurl: https://x.com/a/status/1\n:::'), null);
  assert.equal(serializeXPostPreviewMd({ url: '', postId: '1', tldrStatus: 'skipped' }), null);
});
