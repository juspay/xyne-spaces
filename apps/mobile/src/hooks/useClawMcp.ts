import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listMcpConnections, listMcpServers } from '@/src/services/claw/clawMcpService';
import type { McpServer, UserConnection } from '@/src/services/claw/clawMcpTypes';

export const CLAW_MCP_QUERY_KEY = 'claw-mcp';

export type ClawMcpData = {
  servers: McpServer[];
  connections: UserConnection[];
};

export const useClawMcp = (userId?: string, enabled = true): UseQueryResult<ClawMcpData, Error> =>
  useQuery({
    queryKey: [CLAW_MCP_QUERY_KEY, userId ?? ''],
    queryFn: async (): Promise<ClawMcpData> => {
      const [servers, connections] = await Promise.all([
        listMcpServers(),
        userId ? listMcpConnections(userId) : Promise.resolve([]),
      ]);
      return { servers, connections };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
