import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  escapeHtml,
  looksLikeHtml,
  preprocessEmailHtml,
} from '@/src/features/xyne-desks/detail/utils/preprocess-email-html';

describe('preprocessEmailHtml', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(preprocessEmailHtml(''), '');
  });

  it('strips <style> and <script> blocks', () => {
    const out = preprocessEmailHtml(
      '<style>.a{color:red}</style><p>Hi</p><script>alert(1)</script>',
    );
    assert.ok(!out.includes('color:red'));
    assert.ok(!out.includes('alert(1)'));
    assert.ok(out.includes('<p>Hi</p>'));
  });

  it('removes Outlook MSO conditional comments', () => {
    const out = preprocessEmailHtml('<!--[if mso]><table></table><![endif]--><p>Body</p>');
    assert.ok(!out.includes('mso'));
    assert.ok(out.includes('<p>Body</p>'));
  });

  it('drops Office namespace tags', () => {
    const out = preprocessEmailHtml('<o:p>x</o:p><p>Body</p>');
    assert.ok(!out.includes('<o:p>'));
    assert.ok(out.includes('Body'));
  });

  it('strips dangerous tags such as iframe, form, and svg', () => {
    const out = preprocessEmailHtml(
      '<iframe src="x"></iframe><form><input></form><svg></svg><p>Safe</p>',
    );
    assert.ok(!out.includes('<iframe'));
    assert.ok(!out.includes('<form'));
    assert.ok(!out.includes('<input'));
    assert.ok(!out.includes('<svg'));
    assert.ok(out.includes('<p>Safe</p>'));
  });

  it('extracts the <body> contents when present', () => {
    const out = preprocessEmailHtml('<html><head></head><body><p>Inner</p></body></html>');
    assert.equal(out, '<p>Inner</p>');
  });

  it('leaves body-less content intact', () => {
    assert.equal(preprocessEmailHtml('<p>Plain</p>'), '<p>Plain</p>');
  });
});

describe('looksLikeHtml', () => {
  it('detects markup', () => {
    assert.equal(looksLikeHtml('<p>hi</p>'), true);
    assert.equal(looksLikeHtml('<br>'), true);
    assert.equal(looksLikeHtml('text with </span> close'), true);
  });

  it('returns false for plain text', () => {
    assert.equal(looksLikeHtml('just plain text'), false);
    assert.equal(looksLikeHtml('a < b and c > d'), false);
  });
});

describe('escapeHtml', () => {
  it('escapes the five sensitive characters', () => {
    assert.equal(
      escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`),
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  it('escapes ampersands before other entities so it is idempotent-safe', () => {
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('a&b<c'), 'a&amp;b&lt;c');
  });
});
