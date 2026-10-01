import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer, UserConnection } from './clawMcpTypes';

const items = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  },
  setTimeout: (fn: () => void) => {
    fn();
    return 0;
  },
});

const { fakeConnect, fakeDisconnect, isFakeConnection, withFakeConnections } =
  await import('./fakeMcpConnect');

const github = { id: 'srv-github', type: 'github', name: 'GitHub' } as McpServer;
const slack = { id: 'srv-slack', type: 'slack', name: 'Slack' } as McpServer;
const real = {
  id: 'c1',
  userId: 'u1',
  mcpServerId: 'srv-slack',
  mcpServer: slack,
} as UserConnection;

beforeEach(() => items.clear());

describe('pretend connections', () => {
  it('shows a pretend connect next to the real ones, for that user only', async () => {
    await fakeConnect('u1', 'srv-github');
    const merged = withFakeConnections('u1', [github, slack], [real]);
    expect(merged.map(connection => connection.mcpServerId)).toEqual(['srv-slack', 'srv-github']);
    expect(isFakeConnection(merged[1]!.id)).toBe(true);
    expect(withFakeConnections('u2', [github, slack], [])).toEqual([]);
  });

  it('defers to a real connection and drops servers that are gone', async () => {
    await fakeConnect('u1', 'srv-slack');
    await fakeConnect('u1', 'srv-removed');
    expect(withFakeConnections('u1', [github, slack], [real])).toEqual([real]);
  });

  it('disconnects', async () => {
    await fakeConnect('u1', 'srv-github');
    const [connection] = withFakeConnections('u1', [github], []);
    fakeDisconnect('u1', connection!.id);
    expect(withFakeConnections('u1', [github], [])).toEqual([]);
  });
});
