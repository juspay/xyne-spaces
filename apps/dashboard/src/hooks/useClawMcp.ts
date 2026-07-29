import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listMcpConnections, listMcpServers } from '../services/claw/clawMcpService';
import type { McpServer, UserConnection } from '../services/claw/clawMcpTypes';

export interface ClawMcpData {
  servers: McpServer[];
  connections: UserConnection[];
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
      const [servers, connections] = await Promise.all([
        listMcpServers(),
        listMcpConnections(userId!),
      ]);
      return { servers, connections };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
};
