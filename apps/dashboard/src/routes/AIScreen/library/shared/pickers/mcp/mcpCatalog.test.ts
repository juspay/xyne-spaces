import { describe, expect, it } from 'vitest';
import type { AvailableTools, Integration } from '@/services/claw/clawToolsTypes';
import { buildMcpCatalog, disableEntry, enableEntry, isEntryEnabled } from './mcpCatalog';

const tool = (name: string, riskLevel: 'read' | 'write' = 'read') => ({
  slug: name,
  name,
  description: '',
  riskLevel,
});

const mcp = (slug: string, read: string[], write: string[] = []): Integration => ({
  slug,
  label: slug,
  kind: 'mcp',
  connected: true,
  readTools: read.map(name => tool(name)),
  writeTools: write.map(name => tool(name, 'write')),
  usageCount: 0,
});

const catalog = buildMcpCatalog(
  {
    subagents: [],
    mcpServers: [],
    writeTools: [],
    customGroups: [],
    serverTools: {},
    integrations: [
      mcp('github', ['list_pull_requests'], ['merge_pull_request']),
      mcp('bitbucket', ['list_repositories'], ['merge_pull_request']),
      mcp('slack', ['read_channel']),
    ],
  } as AvailableTools,
  [],
);
const entry = (slug: string) => catalog.find(item => item.slug === slug)!;
const empty = { subagents: [], direct: [], custom: [], gateway: [] };

describe('tool names two connectors share', () => {
  it('picks the shared tool with its connector in front', () => {
    const next = enableEntry(catalog, empty, entry('github'));
    expect(next.direct).toEqual(['list_pull_requests', 'github__merge_pull_request']);
  });

  it('turns on only the connector that was picked', () => {
    const next = enableEntry(catalog, empty, entry('github'));
    expect(isEntryEnabled(next, entry('github'))).toBe(true);
    expect(isEntryEnabled(next, entry('bitbucket'))).toBe(false);
  });

  it('keeps one connector on when the other is turned off', () => {
    const both = enableEntry(
      catalog,
      enableEntry(catalog, empty, entry('github')),
      entry('bitbucket'),
    );
    const next = disableEntry(catalog, both, entry('github'));
    expect(isEntryEnabled(next, entry('github'))).toBe(false);
    expect(isEntryEnabled(next, entry('bitbucket'))).toBe(true);
    expect(next.direct).toEqual(['list_repositories', 'bitbucket__merge_pull_request']);
  });

  it('reads a bare shared name saved earlier as the connector with its other tools picked', () => {
    const saved = { ...empty, direct: ['list_pull_requests', 'merge_pull_request'] };
    expect(isEntryEnabled(saved, entry('github'))).toBe(true);
    expect(isEntryEnabled(saved, entry('bitbucket'))).toBe(false);
  });

  it('rewrites a bare shared name for its owner on the next change', () => {
    const saved = { ...empty, direct: ['list_pull_requests', 'merge_pull_request'] };
    const next = enableEntry(catalog, saved, entry('slack'));
    expect(next.direct).toEqual([
      'list_pull_requests',
      'github__merge_pull_request',
      'read_channel',
    ]);
    expect(isEntryEnabled(next, entry('bitbucket'))).toBe(false);
  });

  it('leaves names only one connector has as they were', () => {
    const next = enableEntry(catalog, empty, entry('slack'));
    expect(next.direct).toEqual(['read_channel']);
  });
});
