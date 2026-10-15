import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codeBlockHtmlToEscapedText } from '@/src/utils/codeBlockHtml';

describe('codeBlockHtmlToEscapedText', () => {
  it('normalizes native code block paragraphs to escaped text', () => {
    const html = [
      '<p>// Example</p>',
      '<p>class Product {</p>',
      '<p>  constructor(name, stock) {</p>',
      '<p>    this.stock = stock;</p>',
      '<p>  }</p>',
      '<p></p>',
      '<p>  isLow() {</p>',
      '<p>    return this.stock &lt; 5;</p>',
      '<p>  }</p>',
      '<p>}</p>',
    ].join('');

    assert.equal(
      codeBlockHtmlToEscapedText(html),
      [
        '// Example',
        'class Product {',
        '  constructor(name, stock) {',
        '    this.stock = stock;',
        '  }',
        '',
        '  isLow() {',
        '    return this.stock &lt; 5;',
        '  }',
        '}',
      ].join('\n'),
    );
  });
});
