import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTextToComposerHtml,
  appendMarkupToComposerHtml,
} from '@/src/components/input-composer/utils/composer-html';

describe('appendTextToComposerHtml', () => {
  it('returns the original html when there is nothing to append', () => {
    assert.equal(
      appendTextToComposerHtml('<html><p>hi</p></html>', '', 'hi'),
      '<html><p>hi</p></html>',
    );
  });

  it('rebuilds from the plain body when the composer is empty', () => {
    assert.equal(appendTextToComposerHtml('', ':)', 'hello'), '<html><p>hello</p></html>');
  });

  it('rebuilds from the plain body when the composer is a blank paragraph', () => {
    assert.equal(
      appendTextToComposerHtml('<html><p></p></html>', ':)', 'hi'),
      '<html><p>hi</p></html>',
    );
  });

  it('appends inside the last paragraph, preserving existing markup', () => {
    assert.equal(
      appendTextToComposerHtml('<html><p>hi</p></html>', '!', 'ignored'),
      '<html><p>hi!</p></html>',
    );
  });

  it('inserts a paragraph before </html> when there is no paragraph to append to', () => {
    assert.equal(
      appendTextToComposerHtml('<html><span>x</span></html>', 'Y', 'ignored'),
      '<html><span>x</span><p>Y</p></html>',
    );
  });
});

describe('appendMarkupToComposerHtml', () => {
  it('wraps markup in a paragraph when the composer is empty', () => {
    assert.equal(
      appendMarkupToComposerHtml('', '<img src="file://e.gif" width="16" height="16"/>'),
      '<html><p><img src="file://e.gif" width="16" height="16"/></p></html>',
    );
  });

  it('keeps img markup instead of rebuilding from a shortcode body', () => {
    assert.match(
      appendMarkupToComposerHtml(
        '<html><p></p></html>',
        '<img src="file://e.gif" width="16" height="16"/>',
      ),
      /<img src="file:\/\/e\.gif"/,
    );
  });

  it('appends a second image after existing text and the first image', () => {
    const html = '<html><p>hello <img src="file://a.gif" width="16" height="16"/></p></html>';
    const next = appendMarkupToComposerHtml(
      html,
      ' <img src="file://b.gif" width="16" height="16"/>',
    );
    assert.match(next, /hello <img src="file:\/\/a\.gif"/);
    assert.match(next, /<img src="file:\/\/b\.gif"/);
    assert.ok(next.indexOf('a.gif') < next.indexOf('b.gif'));
  });
});
