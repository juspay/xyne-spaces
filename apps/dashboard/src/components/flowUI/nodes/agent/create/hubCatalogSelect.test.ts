import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  matchNamedMcpEntries,
  selectionFromCatalogSuggestion,
} from './hubCatalogSelect.ts';
import type { AvailableTools, ToolSuggestion } from '@/services/claw/clawToolsTypes';
import { EMPTY_TOOLS } from './types.ts';

function catalogWithSlackGithub(): AvailableTools {
  return {
    subagents: [],
    mcpServers: [],
    writeTools: [],
    customGroups: [],
    serverTools: {},
    integrations: [
      {
        slug: 'slack',
        label: 'Slack',
        kind: 'mcp',
        connected: true,
        readTools: [{ slug: 'slack_list', name: 'slack_list', description: '', riskLevel: 'read' }],
        writeTools: [
          { slug: 'slack_post', name: 'slack_post', description: '', riskLevel: 'write' },
        ],
        usageCount: 3,
      },
      {
        slug: 'github',
        label: 'GitHub',
        kind: 'mcp',
        connected: true,
        readTools: [{ slug: 'gh_list', name: 'gh_list', description: '', riskLevel: 'read' }],
        writeTools: [],
        usageCount: 2,
      },
      {
        slug: 'gateway:jira/primary',
        label: 'Jira',
        kind: 'gateway',
        connected: true,
        readTools: [
          { slug: 'jira:read', name: 'jira_read', description: '', riskLevel: 'read' },
        ],
        writeTools: [],
        usageCount: 1,
      },
    ],
  };
}

void describe('hubCatalogSelect', () => {
  void it('matches named Slack / GitHub products in the utterance', () => {
    const catalog = catalogWithSlackGithub();
    const slack = matchNamedMcpEntries('standup bot that posts to Slack', catalog);
    assert.equal(slack.some(entry => entry.slug === 'slack'), true);
    const github = matchNamedMcpEntries('add the GitHub MCP', catalog);
    assert.equal(github.some(entry => entry.slug === 'github'), true);
  });

  void it('binds named MCP over a blind first-gateway suggestion', () => {
    const catalog = catalogWithSlackGithub();
    const emptySuggestion: ToolSuggestion = {
      subagents: [],
      integrations: [],
      reasoning: {},
    };
    const selection = selectionFromCatalogSuggestion({
      current: { ...EMPTY_TOOLS, callableAgents: [] },
      suggestion: emptySuggestion,
      catalog,
      intent: 'add Slack MCP for standups',
    });
    assert.ok(selection.direct.includes('slack_list') || selection.direct.includes('slack_post'));
    assert.equal((selection.gateway ?? []).includes('jira'), false);
  });

  void it('keeps suggest-tools integration ids when no named product', () => {
    const catalog = catalogWithSlackGithub();
    const suggestion: ToolSuggestion = {
      subagents: [],
      integrations: [{ slug: 'github', readTools: ['gh_list'], writeTools: [] }],
      reasoning: { github: 'repos' },
    };
    const selection = selectionFromCatalogSuggestion({
      current: { ...EMPTY_TOOLS, callableAgents: [] },
      suggestion,
      catalog,
      intent: 'build a code review agent',
    });
    assert.ok(selection.direct.includes('gh_list'));
  });
});
