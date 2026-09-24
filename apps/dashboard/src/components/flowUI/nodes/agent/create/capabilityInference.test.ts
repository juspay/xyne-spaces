import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferNeededCapabilities,
  inferredCapabilityFields,
  softProductNeedles,
} from './capabilityInference.ts';
import {
  canvasHasCapability,
  validateCanvasCapabilities,
} from './capabilityValidation.ts';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import { EMPTY_CREATE_FORM, EMPTY_TOOLS } from './types.ts';

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

  void it('soft-cues Slack from standup/channel', () => {
    assert.ok(softProductNeedles('standup scribe for eng channel').includes('slack'));
  });

  void it('soft-cues email from “emails the lead”', () => {
    const needles = softProductNeedles('agent that emails the lead a digest');
    assert.ok(needles.includes('gmail') || needles.includes('email'), JSON.stringify(needles));
    assert.ok(inferNeededCapabilities('agent that emails the lead').includes('mcp'));
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
