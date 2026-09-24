import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLocalHubBinds,
  matchNamedMcpEntries,
  selectionFromCatalogSuggestion,
} from './hubCatalogSelect.ts';
import type { AvailableTools, ToolSuggestion } from '@/services/claw/clawToolsTypes';
import { EMPTY_TOOLS } from './types.ts';

const DESIGN_DIGEST_JOB =
  'Daily 12pm agent that emails and DMs Devesh the top 10 design posts from X.com via Spaces DM';

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

function designDigestCatalog(): AvailableTools {
  return {
    subagents: [],
    mcpServers: [],
    writeTools: [],
    customGroups: [
      {
        source: 'custom:send-email',
        tools: [{ slug: 'send_email', name: 'Send email' }],
      },
      {
        source: 'custom:send-message',
        tools: [{ slug: 'send_message', name: 'Send message' }],
      },
      {
        source: 'custom:web-search',
        tools: [{ slug: 'web_search', name: 'Web search' }],
      },
      {
        source: 'custom:webfetch',
        tools: [{ slug: 'webfetch', name: 'webfetch' }],
      },
    ],
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
        slug: 'x-ai-accounts',
        label: 'X (AI accounts)',
        kind: 'mcp',
        connected: true,
        readTools: [{ slug: 'x_search', name: 'x_search', description: '', riskLevel: 'read' }],
        writeTools: [],
        usageCount: 2,
      },
      {
        slug: 'xyne-spaces',
        label: 'Xyne Spaces',
        kind: 'mcp',
        connected: true,
        readTools: [
          { slug: 'spaces-search', name: 'spaces-search', description: '', riskLevel: 'read' },
        ],
        writeTools: [
          {
            slug: 'spaces-send-message',
            name: 'spaces-send-message',
            description: '',
            riskLevel: 'write',
          },
        ],
        usageCount: 5,
      },
      {
        slug: 'xyne-spaces-app-tools',
        label: 'Xyne Spaces App Tools',
        kind: 'mcp',
        connected: true,
        readTools: [],
        writeTools: [
          {
            slug: 'apps-send-message',
            name: 'apps-send-message',
            description: '',
            riskLevel: 'write',
          },
        ],
        usageCount: 4,
      },
      {
        slug: 'custom:send-email',
        label: 'Send email',
        kind: 'custom',
        connected: true,
        readTools: [],
        writeTools: [
          { slug: 'send_email', name: 'Send email', description: '', riskLevel: 'write' },
        ],
        usageCount: 2,
      },
      {
        slug: 'custom:send-message',
        label: 'Send message',
        kind: 'custom',
        connected: true,
        readTools: [],
        writeTools: [
          { slug: 'send_message', name: 'Send message', description: '', riskLevel: 'write' },
        ],
        usageCount: 2,
      },
      {
        slug: 'custom:web-search',
        label: 'Web Search',
        kind: 'custom',
        connected: true,
        readTools: [
          { slug: 'web_search', name: 'Web search', description: '', riskLevel: 'read' },
        ],
        writeTools: [],
        usageCount: 2,
      },
      {
        slug: 'custom:webfetch',
        label: 'Webfetch',
        kind: 'custom',
        connected: true,
        readTools: [{ slug: 'webfetch', name: 'webfetch', description: '', riskLevel: 'read' }],
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

  void it('soft-cues Slack + builtin from standup/research without MCP nouns', () => {
    const catalog: AvailableTools = {
      ...catalogWithSlackGithub(),
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
      'Create a scribe that posts daily summaries for standup and researches competitors on the web',
      catalog,
      { ...EMPTY_TOOLS, callableAgents: [] },
    );
    assert.ok(
      selection.direct.includes('slack_list') || selection.direct.includes('slack_post'),
      JSON.stringify(selection),
    );
    assert.ok(selection.custom.includes('web_search'), JSON.stringify(selection));
  });

  void it('design digest: X + Spaces MCP, no Slack; email/DM/web builtins bound', () => {
    const catalog = designDigestCatalog();
    const named = matchNamedMcpEntries(DESIGN_DIGEST_JOB, catalog);
    assert.ok(
      named.some(e => e.slug === 'x-ai-accounts'),
      `expected X, got ${named.map(e => e.slug).join(',')}`,
    );
    assert.ok(
      named.some(e => e.slug === 'xyne-spaces' || e.slug === 'xyne-spaces-app-tools'),
      `expected Spaces, got ${named.map(e => e.slug).join(',')}`,
    );
    assert.equal(
      named.some(e => e.slug === 'slack'),
      false,
      `Slack must not bind: ${named.map(e => e.slug).join(',')}`,
    );

    const selection = applyLocalHubBinds(DESIGN_DIGEST_JOB, catalog, {
      ...EMPTY_TOOLS,
      callableAgents: [],
    });
    assert.equal(
      selection.direct.includes('slack_list') || selection.direct.includes('slack_post'),
      false,
      JSON.stringify(selection),
    );
    assert.ok(selection.direct.includes('x_search'), JSON.stringify(selection));
    assert.ok(
      selection.direct.includes('spaces-search') ||
        selection.direct.includes('spaces-send-message') ||
        selection.direct.includes('apps-send-message'),
      JSON.stringify(selection),
    );
    assert.ok(selection.custom.includes('send_email'), JSON.stringify(selection));
    assert.ok(selection.custom.includes('send_message'), JSON.stringify(selection));
    assert.ok(
      selection.custom.includes('web_search') || selection.custom.includes('webfetch'),
      JSON.stringify(selection),
    );
    // Precision: do not spray unrelated custom groups.
    assert.equal(selection.custom.includes('unrelated'), false);
    assert.ok(selection.custom.length <= 4, JSON.stringify(selection));
  });

  void it('suggest-tools cannot spray Slack onto an X + Spaces job', () => {
    const catalog = designDigestCatalog();
    const suggestion: ToolSuggestion = {
      subagents: [],
      integrations: [
        { slug: 'slack', readTools: ['slack_list'], writeTools: ['slack_post'] },
        { slug: 'x-ai-accounts', readTools: ['x_search'], writeTools: [] },
      ],
      reasoning: { slack: 'messaging', 'x-ai-accounts': 'posts' },
    };
    const selection = selectionFromCatalogSuggestion({
      current: { ...EMPTY_TOOLS, callableAgents: [] },
      suggestion,
      catalog,
      intent: DESIGN_DIGEST_JOB,
    });
    assert.equal(
      selection.direct.includes('slack_list') || selection.direct.includes('slack_post'),
      false,
      JSON.stringify(selection),
    );
    assert.ok(selection.direct.includes('x_search'), JSON.stringify(selection));
  });
});
