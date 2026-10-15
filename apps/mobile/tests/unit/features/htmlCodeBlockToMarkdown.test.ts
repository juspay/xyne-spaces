import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMarkdownCodeBlock } from '@/src/utils/markdownCodeFence';

describe('buildMarkdownCodeBlock', () => {
  it('uses a safe fence when code contains triple backticks', () => {
    assert.equal(
      buildMarkdownCodeBlock('const markdownFence = "```";\nconsole.log(markdownFence);').trim(),
      ['~~~', 'const markdownFence = "```";', 'console.log(markdownFence);', '~~~'].join('\n'),
    );
  });
});
