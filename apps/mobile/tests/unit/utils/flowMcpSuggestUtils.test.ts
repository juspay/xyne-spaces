import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createMcpSuggestViewModel,
  mcpSuggestComponentToMarkdown,
  mcpSuggestInitials,
  mcpSuggestNotificationPreview,
  parseMcpSuggestConnectors,
} from '@/src/utils/flowMcpSuggestUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

const suggest: FlowComponentLike = {
  id: 'mcp-suggest',
  type: 'mcp_suggest',
  props: {
    title: 'Connect to unlock this',
    browseAll: true,
    totalCount: 12,
    connectors: [
      {
        serverType: 'github',
        name: 'GitHub',
        description: 'Repos and PRs',
        connected: false,
      },
      {
        serverType: 'google',
        name: 'Google',
        connected: true,
      },
    ],
  },
};

describe('flowMcpSuggestUtils', () => {
  it('builds a view model with defaults and footer label', () => {
    const viewModel = createMcpSuggestViewModel(suggest);
    assert.ok(viewModel);
    assert.equal(viewModel.title, 'Connect to unlock this');
    assert.equal(viewModel.browseAll, true);
    assert.equal(viewModel.totalCount, 12);
    assert.equal(viewModel.footerLabel, '12 connectors available');
    assert.equal(viewModel.connectors.length, 2);
    assert.equal(viewModel.connectors[0]?.connected, false);
    assert.equal(viewModel.connectors[1]?.connected, true);
  });

  it('defaults title and All connectors footer', () => {
    const viewModel = createMcpSuggestViewModel({
      type: 'mcp_suggest',
      props: {
        browseAll: true,
        connectors: [{ serverType: 'slack', name: 'Slack' }],
      },
    });
    assert.ok(viewModel);
    assert.equal(viewModel.title, 'Connectors that could help');
    assert.equal(viewModel.footerLabel, 'All connectors');
  });

  it('rejects empty or invalid payloads', () => {
    assert.equal(createMcpSuggestViewModel({ type: 'mcp_suggest', props: {} }), null);
    assert.equal(createMcpSuggestViewModel({ type: 'chart' }), null);
    assert.deepEqual(parseMcpSuggestConnectors([{ name: 'x' }]), []);
  });

  it('projects markdown for collapsed preview', () => {
    const markdown = mcpSuggestComponentToMarkdown(suggest);
    assert.match(markdown, /\*\*Connect to unlock this\*\*/);
    assert.match(markdown, /GitHub/);
    assert.match(markdown, /Connect/);
    assert.match(markdown, /Connected/);
    assert.match(markdown, /Browse MCPs/);
  });

  it('builds notification preview and initials', () => {
    const viewModel = createMcpSuggestViewModel(suggest);
    assert.ok(viewModel);
    assert.equal(
      mcpSuggestNotificationPreview(viewModel),
      'Connect to unlock this: GitHub, Google',
    );
    assert.equal(mcpSuggestInitials('GitHub'), 'GI');
    assert.equal(mcpSuggestInitials('Xyne Spaces'), 'XS');
  });
});
