import { describe, expect, it } from 'vitest';
import type { McpCatalogEntry } from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { connectorsToConnect, mcpKeyState } from './buildConnect';
import { EMPTY_TOOLS } from './types';

function entry(slug: string, tool: string, extra: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return {
    slug,
    label: slug,
    description: '',
    iconType: slug,
    usageCount: 0,
    tools: [{ slug: `${slug}-${tool}`, name: tool, description: '', riskLevel: 'read' }],
    server: { id: `srv-${slug}`, type: slug } as McpServer,
    category: 'other',
    isGateway: false,
    scope: 'built-in',
    selectable: true,
    ...extra,
  };
}

const github = entry('github', 'list_prs');
const slack = entry('slack', 'read_channel');
const linear = entry('linear', 'list_issues');
const gateway = entry('gateway:jira:j1', 'search', { isGateway: true });
const spaces = entry('xyne-spaces', 'spaces-search');
const CATALOG = [github, slack, linear, gateway, spaces];

describe('connectorsToConnect', () => {
  it('offers the connectors this turn added that the user has no key for', () => {
    const before = { ...EMPTY_TOOLS, direct: ['list_prs'] };
    const after = { ...EMPTY_TOOLS, direct: ['list_prs', 'read_channel', 'list_issues'] };
    expect(connectorsToConnect(CATALOG, before, after, new Set(['srv-linear']))).toEqual(['slack']);
  });

  it('leaves out Spaces, which runs on the sign-in', () => {
    const after = { ...EMPTY_TOOLS, direct: ['spaces-search'] };
    expect(connectorsToConnect(CATALOG, EMPTY_TOOLS, after, new Set())).toEqual([]);
  });

  it('leaves out gateway services and connectors already on the agent', () => {
    const after = { ...EMPTY_TOOLS, direct: ['list_prs', 'gateway:jira:j1-search'] };
    expect(connectorsToConnect(CATALOG, after, after, new Set())).toEqual([]);
    expect(connectorsToConnect([gateway], EMPTY_TOOLS, after, new Set())).toEqual([]);
  });
});

describe('mcpKeyState', () => {
  it('prefers the personal key, then the org one', () => {
    expect(mcpKeyState(github, new Set(['srv-github']), new Set(['srv-github']))).toBe('personal');
    expect(mcpKeyState(github, new Set(), new Set(['srv-github']))).toBe('org');
    expect(mcpKeyState(github, new Set(), new Set())).toBe('none');
  });
});
