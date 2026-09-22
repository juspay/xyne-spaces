import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  listMcpAvailability,
  listMcpConnections,
  listMcpServers,
  type McpAvailability,
} from '../services/claw/clawMcpService';
import type { McpServer, UserConnection } from '../services/claw/clawMcpTypes';

export interface ClawMcpData {
  servers: McpServer[];
  connections: UserConnection[];
  /** Per connector: your own credential, or one the org provides. */
  availability: McpAvailability[];
}

/**
 * Fetches the MCP catalog and the current user's connections from the claw-auth
 * backend in parallel (mirroring claw-auth's useMcpConnectors). "Connected" is
 * derived by cross-referencing connections against servers by `mcpServerId`.
 */
export const useClawMcp = (): UseQueryResult<ClawMcpData, Error> => {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery({
    queryKey: ['claw-mcp', userId],
    queryFn: async (): Promise<ClawMcpData> => {
      const [servers, connections, availability] = await Promise.all([
        listMcpServers(),
        listMcpConnections(userId!),
        listMcpAvailability(userId!).catch(() => [] as McpAvailability[]),
      ]);
      return { servers, connections, availability };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
};
