import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMarkdownCodeBlock } from '@/src/utils/markdownCodeFence';

describe('buildMarkdownCodeBlock', () => {
  it('wraps plain text in a triple-backtick fence with blank-line padding', () => {
    assert.equal(buildMarkdownCodeBlock('hello'), '\n\n```\nhello\n```\n\n');
  });

  it('includes a trimmed language info string on the opening fence', () => {
    assert.equal(buildMarkdownCodeBlock('x', 'js'), '\n\n```js\nx\n```\n\n');
    assert.equal(buildMarkdownCodeBlock('x', '  ts  '), '\n\n```ts\nx\n```\n\n');
  });

  it('prefers the shorter fence: falls back to tildes when only backticks appear inside', () => {
    // 3 inner backticks would need a 4-backtick fence, but a 3-tilde fence is shorter.
    assert.equal(buildMarkdownCodeBlock('a ``` b'), '\n\n~~~\na ``` b\n~~~\n\n');
  });

  it('prefers the shorter fence: falls back to backticks when only tildes appear inside', () => {
    assert.equal(buildMarkdownCodeBlock('~~~~'), '\n\n```\n~~~~\n```\n\n');
  });

  it('grows a backtick fence past the inner run when both markers are present (tie -> backtick)', () => {
    // Inner has runs of 4 backticks and 4 tildes -> both candidate fences are length 5,
    // and ties resolve to backticks, so the fence is exactly 5 backticks.
    const out = buildMarkdownCodeBlock('```` ~~~~');
    assert.equal(out, '\n\n`````\n```` ~~~~\n`````\n\n');
  });
});
