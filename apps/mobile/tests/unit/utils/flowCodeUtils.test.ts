import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  codeComponentToMarkdown,
  countCodeLines,
  createCodeComponentViewModel,
} from '@/src/utils/flowCodeUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

describe('flowCodeUtils', () => {
  it('counts lines without inflating a trailing newline', () => {
    assert.equal(countCodeLines('a\nb\nc\n'), 3);
    assert.equal(countCodeLines('HELLO WORLD'), 1);
    assert.equal(countCodeLines(''), 0);
  });

  it('builds a code view model from a flow component', () => {
    const component: FlowComponentLike = {
      type: 'code',
      props: {
        code: 'const token = await getFcmToken();\n',
        language: 'typescript',
      },
    };

    const viewModel = createCodeComponentViewModel(component);
    assert.ok(viewModel);
    assert.equal(viewModel.language, 'typescript');
    assert.equal(viewModel.title, 'typescript snippet');
    assert.equal(viewModel.lineCount, 1);
    assert.match(viewModel.code, /getFcmToken/);
  });

  it('omits language when absent and rejects empty code', () => {
    assert.equal(
      createCodeComponentViewModel({
        type: 'code',
        props: { code: 'HELLO WORLD' },
      })?.language,
      undefined,
    );
    assert.equal(createCodeComponentViewModel({ type: 'code', props: { code: '' } }), null);
    assert.equal(createCodeComponentViewModel({ type: 'diff' }), null);
  });

  it('projects code components to markdown fences for the shared codeblock', () => {
    const withLang = codeComponentToMarkdown({
      type: 'code',
      props: { code: 'print("hi")', language: 'python' },
    });
    assert.match(withLang, /```python\nprint\("hi"\)\n```/);
    assert.doesNotMatch(withLang, /\*\*/);

    const withoutLang = codeComponentToMarkdown({
      type: 'code',
      props: { code: 'HELLO WORLD' },
    });
    assert.match(withoutLang, /```\nHELLO WORLD\n```/);
  });
});
