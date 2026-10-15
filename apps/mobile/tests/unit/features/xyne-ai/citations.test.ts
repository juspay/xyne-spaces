import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ToolInvocation } from '@/src/features/xyne-ai/api/xyneAIEvents';
import {
  citationNumbers,
  citationSources,
  linkCitations,
  resolveCitationLink,
} from '@/src/features/xyne-ai/model/citations';

const tools: ToolInvocation[] = [
  {
    toolCallId: 'a',
    toolName: 'spaces',
    args: {},
    status: 'completed',
    durationMs: 0,
    citations: [
      { kind: 'canvas', chunkIndex: 1, label: 'Plan' },
      { kind: 'external', chunkIndex: 2, url: 'https://x.dev' },
    ],
  },
  { toolCallId: 'b', toolName: 'other', args: {}, status: 'completed', durationMs: 0 },
];
const sources = citationSources(tools);

describe('citations', () => {
  it('keeps only calls that carry citations', () => {
    assert.deepEqual(
      sources.map(source => source.toolCallId),
      ['a'],
    );
  });

  it('numbers only citable tools, in order of first use', () => {
    const numbers = citationNumbers('x [clf-b#1] y [clf-a#1]', sources);
    assert.deepEqual([...numbers], [['a', 1]]);
  });

  it('links markers, groups adjacent ones and drops unknown ones', () => {
    const numbers = citationNumbers('[clf-a#1][clf-a#2]', sources);
    assert.equal(
      linkCitations('One [clf-a#1]. Two [clf-a#1] [clf-a#2]. Gone [clf-b#1].', numbers),
      'One [1.1](xyne-cite://clf-a#1). Two [+2](xyne-cite-group://clf-a#1,clf-a#2). Gone .',
    );
  });

  it('resolves a tapped link to its citation or sources', () => {
    assert.deepEqual(resolveCitationLink('xyne-cite://clf-a#1', sources), {
      kind: 'citation',
      citation: { kind: 'canvas', chunkIndex: 1, label: 'Plan' },
    });
    const group = resolveCitationLink('xyne-cite-group://clf-a#1,clf-a#2', sources);
    assert.ok(group?.kind === 'group');
    assert.equal(group.citations.length, 2);
    assert.equal(resolveCitationLink('https://example.com', sources), null);
  });
});
