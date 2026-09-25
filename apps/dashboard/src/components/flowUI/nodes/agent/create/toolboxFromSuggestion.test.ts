import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toolboxFromSuggestion } from './toolboxFromSuggestion.ts';
import type { AvailableTools, ToolSuggestion } from '@/services/claw/clawToolsTypes';

void describe('toolboxFromSuggestion', () => {
  void it('adds only named MCP tools, not every tool on the integration', () => {
    const catalog: AvailableTools = {
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
          usageCount: 1,
          readTools: [
            { slug: 'slack_list', name: 'list_channels', description: '', riskLevel: 'read' },
            { slug: 'slack_hist', name: 'get_history', description: '', riskLevel: 'read' },
          ],
          writeTools: [
            { slug: 'slack_post', name: 'post_message', description: '', riskLevel: 'write' },
          ],
        },
      ],
    };
    const suggestion: ToolSuggestion = {
      subagents: [],
      integrations: [{ slug: 'slack', readTools: ['list_channels'], writeTools: [] }],
      reasoning: {},
    };
    const next = toolboxFromSuggestion(
      { subagents: [], direct: [], custom: [], gateway: [], callableAgents: [] },
      suggestion,
      catalog,
    );
    assert.deepEqual(next.direct, ['list_channels']);
    assert.ok(!next.direct.includes('get_history'));
    assert.ok(!next.direct.includes('post_message'));
  });
});
