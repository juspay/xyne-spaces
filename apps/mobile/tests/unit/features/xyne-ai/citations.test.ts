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
    citations: [
      { kind: 'canvas', chunkIndex: 1, label: 'Plan' },
      { kind: 'external', chunkIndex: 2, url: 'https://x.dev' },
    ],
  },
  { toolCallId: 'b', toolName: 'other', args: {}, status: 'completed' },
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
      linkCitations('One [clf-a#1]. Two [clf-a#1] [clf-a#2]. Gone [clf-b#1].', numbers, sources),
      'One [Plan](xyne-cite://clf-a#1). Two [+2](xyne-cite-group://clf-a#1,clf-a#2). Gone .',
    );
  });

  it('drops citation tokens and links that no tool backs', () => {
    const numbers = citationNumbers('[clf-a#1]', sources);
    assert.equal(
      linkCitations(
        'A [tool-read#0-#1] B [x](cite:clf-a#1) C [x](xyne-cite://clf-b#1) D [clf-a#1]',
        numbers,
        sources,
      ),
      'A  B  C  D [Plan](xyne-cite://clf-a#1)',
    );
  });

  it('splits a list of chunks from one call into separate citations', () => {
    const numbers = citationNumbers('[clf-a#1]', sources);
    const grouped = 'X [+2](xyne-cite-group://clf-a#1,clf-a#2); Y';
    assert.equal(linkCitations('X [clf-a#1, #2]; Y', numbers, sources), grouped);
    assert.equal(linkCitations('X [clf-a#1], #2]; Y', numbers, sources), grouped);
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
