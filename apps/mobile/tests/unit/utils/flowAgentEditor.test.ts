import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AGENT_EDITS_STATE_KEY,
  buildAgentEdits,
  buildModelOptions,
  defaultModelLabel,
  flattenToolSelection,
  isDraftAgentEditable,
  manageItemsFromCatalog,
  mergeManageItems,
  parseToolSelection,
  providerLine,
  selectionHasAnyId,
  toggleCapabilityIds,
  withoutCapabilityIds,
} from '@/src/utils/flowAgentEditor';

describe('flowAgentEditor', () => {
  it('treats missing toolSelection as not editable', () => {
    assert.equal(isDraftAgentEditable({ phase: 'pending', toolSelection: undefined }), false);
    assert.equal(isDraftAgentEditable({ phase: 'pending', toolSelection: {} }), true);
    assert.equal(
      isDraftAgentEditable({ phase: 'pending', submitting: true, toolSelection: {} }),
      false,
    );
  });

  it('parses buckets and flattens them for values.agent', () => {
    const selection = parseToolSelection({
      subagents: ['github'],
      direct: ['web-search'],
      callableAgents: ['triage'],
    });
    assert.ok(selection);
    assert.deepEqual(flattenToolSelection(selection), ['github', 'web-search', 'triage']);
  });

  it('removes and toggles ids without granting unknown buckets', () => {
    const start = parseToolSelection({
      subagents: ['github'],
      direct: ['gh-prs', 'gh-issues'],
      custom: ['web-search'],
    });
    assert.ok(start);
    assert.deepEqual(withoutCapabilityIds(start, ['gh-prs']).direct, ['gh-issues']);
    const dropped = toggleCapabilityIds(start, 'mcp', ['gh-prs', 'gh-issues'], true);
    assert.deepEqual(dropped.direct, []);
    const added = toggleCapabilityIds(dropped, 'mcp', ['gh-prs'], false);
    assert.deepEqual(added.direct, ['gh-prs']);
    assert.equal(selectionHasAnyId(added, ['gh-prs']), true);
  });

  it('builds agent-edits and default model labels', () => {
    assert.equal(defaultModelLabel(undefined), 'Platform default');
    assert.equal(defaultModelLabel('claude'), 'Anthropic Claude default');
    assert.equal(providerLine([]), 'Spaces default');
    assert.equal(providerLine(['claude', 'spaces']), 'claude → spaces');
    assert.deepEqual(
      buildModelOptions({ modelId: 'opus', provider: 'claude' }).map(option => option.value),
      ['', 'opus'],
    );
    const edits = buildAgentEdits({
      selection: parseToolSelection({ subagents: ['github'] })!,
      modelId: 'x'.repeat(200),
      providerOrder: ['claude'],
    });
    assert.equal(edits.modelId.length, 120);
    assert.equal(AGENT_EDITS_STATE_KEY, 'agent-edits');
  });

  it('builds manage lists from the workspace catalog', () => {
    const items = manageItemsFromCatalog(
      {
        subagents: [{ name: 'github', description: 'GitHub specialist' }],
        customGroups: [
          { source: 'web-search', tools: [{ slug: 'web_search', name: 'Web Search' }] },
        ],
        integrations: [
          {
            slug: 'linear',
            label: 'Linear',
            kind: 'mcp',
            readTools: [{ slug: 'list-issues', name: 'list_issues' }],
            writeTools: [],
          },
        ],
      },
      'mcp',
    );
    assert.deepEqual(items, [
      { id: 'linear', name: 'Linear', description: 'list_issues', ids: ['list_issues'] },
    ]);
    assert.equal(manageItemsFromCatalog(null, 'subagent').length, 0);
    assert.deepEqual(
      mergeManageItems(items, [{ id: 'linear', name: 'Old', description: '', ids: ['x'] }]).length,
      1,
    );
  });
});
