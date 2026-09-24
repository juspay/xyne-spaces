import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLocalHubBinds,
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

  void it('does not bind a blind first gateway when named product misses catalog', () => {
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
      intent: 'add Notion MCP',
    });
    assert.equal(selection.direct.length, 0);
    assert.equal((selection.gateway ?? []).length, 0);
  });

  void it('binds Slack MCP plus a catalog subagent when both are requested', () => {
    const catalog: AvailableTools = {
      ...catalogWithSlackGithub(),
      subagents: [
        {
          name: 'web-research',
          description: 'Web research helper',
          serverType: 'custom',
          progressLabel: 'Researching',
        },
        {
          name: 'code-review',
          description: 'Reviews diffs',
          serverType: 'custom',
          progressLabel: 'Reviewing',
        },
      ],
      customGroups: [
        {
          source: 'custom:web-search',
          tools: [{ slug: 'web_search', name: 'web_search' }],
        },
      ],
      integrations: [
        ...catalogWithSlackGithub().integrations,
        {
          slug: 'custom:web-search',
          label: 'Web Search',
          kind: 'custom',
          connected: true,
          readTools: [
            { slug: 'web_search', name: 'web_search', description: '', riskLevel: 'read' },
          ],
          writeTools: [],
          usageCount: 2,
        },
      ],
    };
    const selection = applyLocalHubBinds(
      'use Slack MCP, a web-research subagent, and built-in web search',
      catalog,
      { ...EMPTY_TOOLS, callableAgents: [] },
    );
    assert.ok(selection.direct.includes('slack_list') || selection.direct.includes('slack_post'));
    assert.ok(selection.subagents.includes('web-research'));
    assert.ok(selection.custom.includes('web_search'));
  });
});
