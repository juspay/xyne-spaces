import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dropUnresolvableTokens,
  extractCitationRuns,
  linkifyMentions,
  linkifyTicketIds,
  prepareBriefLine,
  stripCitationTokens,
  tidy,
  type BriefLineContext,
} from '@/src/features/morning-brief/utils/briefText';

const contextWith = (overrides: Partial<BriefLineContext> = {}): BriefLineContext => ({
  isRoutable: () => true,
  ticketPrefixes: new Set(),
  resolveUserName: () => null,
  resolveChannelName: () => null,
  ...overrides,
});

describe('tidy', () => {
  it('collapses runs of spaces and pulls punctuation tight', () => {
    assert.equal(tidy('Ship  it ,  today .'), 'Ship it, today.');
  });
});

describe('stripCitationTokens', () => {
  it('removes malformed clf tokens the strict regex rejects', () => {
    assert.equal(
      stripCitationTokens('Fix rollout [clf-chatcmpl-tool-abc#1-20] before noon'),
      'Fix rollout before noon',
    );
  });
});

describe('dropUnresolvableTokens', () => {
  it('keeps routable tokens and drops the rest', () => {
    const line = 'A [clf-tool.a:0#1] B [clf-tool.b:0#2]';
    const out = dropUnresolvableTokens(line, toolCallId => toolCallId === 'tool.a:0');
    assert.equal(out, 'A [clf-tool.a:0#1] B ');
  });
});

describe('linkifyMentions', () => {
  it('rewrites user and channel tokens with resolved names', () => {
    const out = linkifyMentions(
      'Ping <@u1> in <#c1>',
      contextWith({
        resolveUserName: id => (id === 'u1' ? 'Asha' : null),
        resolveChannelName: id => (id === 'c1' ? 'launch' : null),
      }),
    );
    assert.equal(out, 'Ping [@Asha](xyne://user/u1) in [#launch](xyne://channel/c1)');
  });

  it('falls back when a mention cannot be resolved', () => {
    const out = linkifyMentions('Ping <@ghost> in <#c9>', contextWith());
    assert.equal(out, 'Ping [@member](xyne://user/ghost) in [#c9](xyne://channel/c9)');
  });

  it('escapes a backslash in a resolved name so the link stays intact', () => {
    const out = linkifyMentions('Ping <@u1>', contextWith({ resolveUserName: () => 'Asha\\' }));
    assert.equal(out, 'Ping [@Asha\\\\](xyne://user/u1)');
  });
});

describe('linkifyTicketIds', () => {
  const prefixes = new Set(['ENG']);

  it('links ticket ids whose prefix matches a project code', () => {
    assert.equal(
      linkifyTicketIds('Fix ENG-42 and OPS-1', prefixes),
      'Fix [ENG-42](xyne-ticket://ENG-42) and OPS-1',
    );
  });

  it('leaves ticket ids inside existing markdown links untouched', () => {
    const line = 'See [ENG-42](https://example.com/ENG-42) plus ENG-7';
    assert.equal(
      linkifyTicketIds(line, prefixes),
      'See [ENG-42](https://example.com/ENG-42) plus [ENG-7](xyne-ticket://ENG-7)',
    );
  });
});

describe('extractCitationRuns', () => {
  it('pulls a single token out as a singleton run', () => {
    const { text, runs } = extractCitationRuns('Review the doc [clf-tool.a:0#3]');
    assert.equal(text, 'Review the doc ');
    assert.deepEqual(runs, [[{ toolCallId: 'tool.a:0', chunkIndex: 3 }]]);
  });

  it('groups adjacent tokens into one run', () => {
    const { text, runs } = extractCitationRuns('Done [clf-a:0#1] [clf-b:0#2]');
    assert.equal(text, 'Done ');
    assert.deepEqual(runs, [
      [
        { toolCallId: 'a:0', chunkIndex: 1 },
        { toolCallId: 'b:0', chunkIndex: 2 },
      ],
    ]);
  });

  it('does not group across line breaks', () => {
    const { runs } = extractCitationRuns('- A [clf-a:0#1]\n- B [clf-b:0#1]');
    assert.deepEqual(runs, [
      [{ toolCallId: 'a:0', chunkIndex: 1 }],
      [{ toolCallId: 'b:0', chunkIndex: 1 }],
    ]);
  });
});

describe('prepareBriefLine', () => {
  it('extracts routable citations as chip runs and cleans the prose', () => {
    const out = prepareBriefLine('Review the doc [clf-tool.a:0#3]', contextWith());
    assert.equal(out.markdown, 'Review the doc');
    assert.deepEqual(out.citationRuns, [[{ toolCallId: 'tool.a:0', chunkIndex: 3 }]]);
  });

  it('drops unroutable tokens before extraction', () => {
    const out = prepareBriefLine(
      'A [clf-tool.a:0#1] B [clf-tool.b:0#2]',
      contextWith({ isRoutable: toolCallId => toolCallId === 'tool.a:0' }),
    );
    assert.equal(out.markdown, 'A B');
    assert.deepEqual(out.citationRuns, [[{ toolCallId: 'tool.a:0', chunkIndex: 1 }]]);
  });

  it('keeps chips for a line whose prose empties out', () => {
    const out = prepareBriefLine('[clf-tool.a:0#1]', contextWith());
    assert.equal(out.markdown, null);
    assert.equal(out.citationRuns.length, 1);
  });

  it('returns nothing for a fully malformed line', () => {
    const out = prepareBriefLine('[clf-broken#1-2]', contextWith());
    assert.equal(out.markdown, null);
    assert.deepEqual(out.citationRuns, []);
  });
});
