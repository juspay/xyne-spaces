import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  looksLikeHtml,
  preprocessEmailHtml,
} from '@/src/features/xyne-desks/detail/utils/preprocess-email-html';

describe('preprocessEmailHtml', () => {
  it('returns empty string for empty input', () => {
    assert.equal(preprocessEmailHtml(''), '');
  });

  it('strips <style> and <script> blocks', () => {
    const out = preprocessEmailHtml(
      '<style>.a{color:red}</style><script>alert(1)</script><p>Hi</p>',
    );
    assert.ok(!out.includes('<style'));
    assert.ok(!out.includes('<script'));
    assert.ok(out.includes('<p>Hi</p>'));
  });

  it('strips Outlook conditional comments', () => {
    const out = preprocessEmailHtml('<!--[if mso]><table></table><![endif]--><p>Body</p>');
    assert.ok(!out.includes('endif'));
    assert.ok(out.includes('<p>Body</p>'));
  });

  it('strips Office namespaced tags (o:, v:, w:, etc.)', () => {
    const out = preprocessEmailHtml('<o:p>x</o:p><v:shape/><p>Real</p>');
    assert.ok(!out.includes('<o:p'));
    assert.ok(!out.includes('<v:shape'));
    assert.ok(out.includes('<p>Real</p>'));
  });

  it('removes dangerous embedded tags', () => {
    const out = preprocessEmailHtml('<iframe src="x"></iframe><object></object><p>ok</p>');
    assert.ok(!out.includes('<iframe'));
    assert.ok(!out.includes('<object'));
    assert.ok(out.includes('<p>ok</p>'));
  });

  it('extracts the <body> inner HTML when present', () => {
    const out = preprocessEmailHtml(
      '<html><head><title>t</title></head><body><p>Inner</p></body></html>',
    );
    assert.equal(out.trim(), '<p>Inner</p>');
  });
});

describe('looksLikeHtml', () => {
  it('detects markup', () => {
    assert.equal(looksLikeHtml('<p>hi</p>'), true);
    assert.equal(looksLikeHtml('a <br> b'), true);
  });

  it('returns false for plain text', () => {
    assert.equal(looksLikeHtml('just plain text'), false);
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML-sensitive characters', () => {
    assert.equal(
      escapeHtml(`<a href="x" data='y'>&`),
      '&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;',
    );
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    assert.equal(escapeHtml('a & <b>'), 'a &amp; &lt;b&gt;');
  });
});
