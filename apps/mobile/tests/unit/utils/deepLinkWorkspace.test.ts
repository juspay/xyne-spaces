import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeWorkspaceIdForLink,
  requiresWorkspaceSwitch,
  resolveDeepLinkWorkspaceDecision,
} from '@/src/utils/deepLinkWorkspace';

const MEMBERSHIPS = [
  { id: 'ws-1', name: 'Acme' },
  { id: 'ws-2', name: 'Globex' },
] as const;

test('resolveDeepLinkWorkspaceDecision: no scope on the link -> open in place', () => {
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', [], MEMBERSHIPS), { action: 'open' });
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', [undefined, null, '  '], MEMBERSHIPS), {
    action: 'open',
  });
});

test('resolveDeepLinkWorkspaceDecision: link already names the active workspace -> open', () => {
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['ws-1'], MEMBERSHIPS), {
    action: 'open',
  });
  // Active workspace in the org+workspace shape, whichever slot it occupies.
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['org-9', 'ws-1'], MEMBERSHIPS), {
    action: 'open',
  });
  assert.deepEqual(resolveDeepLinkWorkspaceDecision(' ws-1 ', ['ws-1'], MEMBERSHIPS), {
    action: 'open',
  });
});

test('resolveDeepLinkWorkspaceDecision: picks the segment that is a member workspace', () => {
  // Web's shape: org first, workspace adjacent to the path.
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['org-9', 'ws-2'], MEMBERSHIPS), {
    action: 'switch',
    targetWorkspaceId: 'ws-2',
    targetWorkspaceName: 'Globex',
  });
  // The same link with the scopes ordered the other way still resolves, because the
  // decision is made by membership rather than by position.
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['ws-2', 'org-9'], MEMBERSHIPS), {
    action: 'switch',
    targetWorkspaceId: 'ws-2',
    targetWorkspaceName: 'Globex',
  });
});

test('resolveDeepLinkWorkspaceDecision: prefers the workspace slot when both match', () => {
  const memberships = [
    { id: 'outer', name: 'Outer' },
    { id: 'inner', name: 'Inner' },
  ] as const;
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['outer', 'inner'], memberships), {
    action: 'switch',
    targetWorkspaceId: 'inner',
    targetWorkspaceName: 'Inner',
  });
});

test('resolveDeepLinkWorkspaceDecision: no segment is a member workspace -> unavailable', () => {
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['org-9', 'ws-other'], MEMBERSHIPS), {
    action: 'unavailable',
  });
});

test('resolveDeepLinkWorkspaceDecision: unknown member list -> switch to the workspace slot', () => {
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['org-9', 'ws-2'], null), {
    action: 'switch',
    targetWorkspaceId: 'ws-2',
  });
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('ws-1', ['  ws-2  '], null), {
    action: 'switch',
    targetWorkspaceId: 'ws-2',
  });
});

test('resolveDeepLinkWorkspaceDecision: unknown active workspace -> open in place', () => {
  // A cold cache gives nothing to compare against; opening in place beats switching
  // on a hunch, and the chat screen still surfaces an unavailable target.
  assert.deepEqual(resolveDeepLinkWorkspaceDecision(null, ['ws-2'], null), { action: 'open' });
  assert.deepEqual(resolveDeepLinkWorkspaceDecision('', ['ws-2'], null), { action: 'open' });
});

test('requiresWorkspaceSwitch: no scope or already in the named workspace -> false', () => {
  assert.equal(requiresWorkspaceSwitch({}, 'ws-1'), false);
  assert.equal(requiresWorkspaceSwitch({ workspaceId: 'ws-1' }, 'ws-1'), false);
  assert.equal(requiresWorkspaceSwitch({ orgId: 'org-9', workspaceId: 'ws-1' }, 'ws-1'), false);
  assert.equal(requiresWorkspaceSwitch({ workspaceId: 'ws-2' }, null), false);
  assert.equal(requiresWorkspaceSwitch({ workspaceId: 'ws-2' }, '  '), false);
});

test('requiresWorkspaceSwitch: named workspace is not the active one -> true', () => {
  assert.equal(requiresWorkspaceSwitch({ workspaceId: 'ws-2' }, 'ws-1'), true);
  assert.equal(requiresWorkspaceSwitch({ orgId: 'org-9', workspaceId: 'ws-2' }, 'ws-1'), true);
});

test('normalizeWorkspaceIdForLink: blank/null/undefined -> undefined', () => {
  assert.equal(normalizeWorkspaceIdForLink(null), undefined);
  assert.equal(normalizeWorkspaceIdForLink(undefined), undefined);
  assert.equal(normalizeWorkspaceIdForLink(''), undefined);
  assert.equal(normalizeWorkspaceIdForLink('   '), undefined);
});

test('normalizeWorkspaceIdForLink: real id -> trimmed id', () => {
  assert.equal(normalizeWorkspaceIdForLink('ws-1'), 'ws-1');
  assert.equal(normalizeWorkspaceIdForLink('  ws-1  '), 'ws-1');
});
