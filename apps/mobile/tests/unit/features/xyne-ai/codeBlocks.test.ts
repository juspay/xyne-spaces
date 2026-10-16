import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitCodeBlocks } from '@/src/features/xyne-ai/model/codeBlocks';

describe('splitCodeBlocks', () => {
  it('keeps prose without code as one segment', () => {
    assert.deepEqual(splitCodeBlocks('Hello **there**'), [
      { kind: 'text', value: 'Hello **there**' },
    ]);
  });

  it('splits closed fences out of the prose', () => {
    assert.deepEqual(splitCodeBlocks('Run:\n```sh\nnpm test\n```\nDone.'), [
      { kind: 'text', value: 'Run:\n' },
      { kind: 'code', value: 'npm test' },
      { kind: 'text', value: '\nDone.' },
    ]);
  });

  it('treats a fence still open at the end as code', () => {
    assert.deepEqual(splitCodeBlocks('Here:\n```ts\nconst a = 1;\n'), [
      { kind: 'text', value: 'Here:\n' },
      { kind: 'code', value: 'const a = 1;' },
    ]);
  });
});
