import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferNeededCapabilities,
  inferredCapabilityFields,
  softBuiltinNeedles,
  softProductNeedles,
} from './capabilityInference.ts';
import {
  canvasHasCapability,
  validateCanvasCapabilities,
} from './capabilityValidation.ts';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import { EMPTY_CREATE_FORM, EMPTY_TOOLS } from './types.ts';

const DESIGN_DIGEST_JOB =
  'daily 12pm agent that emails and DMs Devesh the top 10 design posts from X.com via Spaces DM';

void describe('capabilityInference', () => {
  void it('infers mcp+builtin+knowledge from job without MCP nouns', () => {
    const text =
      'Create a scribe that posts daily summaries to the eng channel, emails the lead, and researches competitors on the web using our product docs.';
    const needed = inferNeededCapabilities(text);
    assert.ok(needed.includes('mcp'), JSON.stringify(needed));
    assert.ok(needed.includes('builtin'), JSON.stringify(needed));
    assert.ok(needed.includes('knowledge'), JSON.stringify(needed));
    assert.deepEqual(inferredCapabilityFields(text), ['tools', 'knowledge']);
  });

  void it('soft-cues Slack from standup (not bare DM)', () => {
    assert.ok(softProductNeedles('standup scribe for eng channel').includes('slack'));
    assert.equal(softProductNeedles('DM Devesh the digest').includes('slack'), false);
  });

  void it('soft-cues Spaces — not Slack — for Spaces DM + X.com digest', () => {
    const needles = softProductNeedles(DESIGN_DIGEST_JOB);
    assert.ok(
      needles.some(n => /spaces/i.test(n)),
      JSON.stringify(needles),
    );
    assert.equal(needles.includes('slack'), false, JSON.stringify(needles));
    assert.ok(
      needles.some(n => /twitter|x\.com/i.test(n)),
      JSON.stringify(needles),
    );
  });

  void it('soft-cues builtin email/DM/web needles for design digest', () => {
    const builtins = softBuiltinNeedles(DESIGN_DIGEST_JOB);
    assert.ok(builtins.some(n => /email/i.test(n)), JSON.stringify(builtins));
    assert.ok(builtins.some(n => /send[-_\s]?message/i.test(n)), JSON.stringify(builtins));
    assert.ok(builtins.some(n => /web[-_\s]?search|webfetch/i.test(n)), JSON.stringify(builtins));
    const needed = inferNeededCapabilities(DESIGN_DIGEST_JOB);
    assert.ok(needed.includes('mcp'), JSON.stringify(needed));
    assert.ok(needed.includes('builtin'), JSON.stringify(needed));
  });

  void it('does not soft-cue Gmail MCP from bare “emails the lead”', () => {
    const needles = softProductNeedles('agent that emails the lead a digest');
    assert.equal(needles.includes('gmail'), false, JSON.stringify(needles));
    assert.ok(inferNeededCapabilities('agent that emails the lead').includes('builtin'));
  });

  void it('soft-cues Gmail when Gmail is named', () => {
    assert.ok(softProductNeedles('send via Gmail').includes('gmail'));
  });

  void it('leaves vague make-an-agent empty', () => {
    assert.deepEqual(inferNeededCapabilities('make an agent'), []);
  });
});

void describe('capabilityValidation', () => {
  const catalog: AvailableTools = {
    subagents: [{ name: 'deepwiki', description: 'docs', serverType: 'custom', progressLabel: '' }],
    mcpServers: [],
    writeTools: [],
    customGroups: [
      { source: 'custom:web-search', tools: [{ slug: 'web_search', name: 'web_search' }] },
    ],
    serverTools: {},
    integrations: [
      {
        slug: 'slack',
        label: 'Slack',
        kind: 'mcp',
        connected: true,
        readTools: [{ slug: 'slack_list', name: 'slack_list', description: '', riskLevel: 'read' }],
        writeTools: [],
        usageCount: 1,
      },
      {
        slug: 'custom:web-search',
        label: 'Web Search',
        kind: 'custom',
        connected: true,
        readTools: [
          { slug: 'web_search', name: 'web_search', description: '', riskLevel: 'read' },
        ],
        writeTools: [],
        usageCount: 1,
      },
    ],
  };

  void it('flags missing mcp/builtin as healable when catalog can satisfy', () => {
    const intent =
      'standup scribe that posts to the eng channel and researches competitors on the web';
    const result = validateCanvasCapabilities({
      intent,
      form: { ...EMPTY_CREATE_FORM, tools: { ...EMPTY_TOOLS } },
      catalog,
      skillCount: 0,
      knowledgeCount: 0,
    });
    assert.ok(result.needed.includes('mcp'));
    assert.ok(result.needed.includes('builtin'));
    assert.ok(result.healable.includes('mcp'));
    assert.ok(result.healable.includes('builtin'));
    assert.equal(result.ok, false);
  });

  void it('passes when canvas chips cover needed classes', () => {
    const form = {
      ...EMPTY_CREATE_FORM,
      tools: {
        ...EMPTY_TOOLS,
        direct: ['slack_list'],
        custom: ['web_search'],
      },
    };
    assert.equal(canvasHasCapability(form, 'mcp'), true);
    assert.equal(canvasHasCapability(form, 'builtin'), true);
    const result = validateCanvasCapabilities({
      intent: 'standup channel research on the web',
      form,
      catalog,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.healable, []);
  });
});
