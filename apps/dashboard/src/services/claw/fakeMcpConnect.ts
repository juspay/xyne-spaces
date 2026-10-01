import type { McpServer, UserConnection } from './clawMcpTypes';

/**
 * Pretend connects, for local development only: a dev build with
 * `VITE_FAKE_MCP_CONNECT=true` (e.g. in a gitignored .env.local).
 *
 * Connect spins for a moment and the connector then shows as yours, with no
 * sign-in, no token form and nothing sent to claw-auth. Pretend connections
 * live in this browser's localStorage and join the real ones wherever
 * connections are read (useClawMcp), so every card and page agrees and a
 * reload keeps them. Disconnect removes them.
 *
 * They are only pretend: runs and the test chat still see the real
 * connections, so a test can still say an account isn't connected.
 */
export const FAKE_MCP_CONNECT =
  import.meta.env.DEV && import.meta.env['VITE_FAKE_MCP_CONNECT'] === 'true';

const FAKE_CONNECT_MS = 1600;
const STORAGE_KEY = 'xyne.fakeMcpConnections.v1';
const ID_PREFIX = 'fake-connection:';

type FakeStore = Record<string, string[]>;

function readStore(): FakeStore {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as FakeStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: FakeStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Blocked storage: the pretend connection lasts until the next refetch.
  }
}

function serverIdsFor(userId: string): string[] {
  const ids = readStore()[userId];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function isFakeConnection(connectionId: string): boolean {
  return connectionId.startsWith(ID_PREFIX);
}

/** The real connections plus the pretend ones, for servers that still exist. */
export function withFakeConnections(
  userId: string,
  servers: readonly McpServer[],
  connections: readonly UserConnection[],
): UserConnection[] {
  const real = new Set(connections.map(connection => connection.mcpServerId));
  const now = new Date().toISOString();
  const fake = serverIdsFor(userId).flatMap(serverId => {
    const server = servers.find(item => item.id === serverId);
    if (!server || real.has(serverId)) return [];
    return [
      {
        id: `${ID_PREFIX}${serverId}`,
        userId,
        mcpServerId: serverId,
        mcpServer: server,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });
  return [...connections, ...fake];
}

/** Waits like a real connect would, then records the server as connected. */
export async function fakeConnect(userId: string, serverId: string): Promise<void> {
  await new Promise(resolve => window.setTimeout(resolve, FAKE_CONNECT_MS));
  const store = readStore();
  const ids = serverIdsFor(userId);
  if (!ids.includes(serverId)) writeStore({ ...store, [userId]: [...ids, serverId] });
}

export function fakeDisconnect(userId: string, connectionId: string): void {
  const serverId = connectionId.slice(ID_PREFIX.length);
  writeStore({ ...readStore(), [userId]: serverIdsFor(userId).filter(id => id !== serverId) });
}
