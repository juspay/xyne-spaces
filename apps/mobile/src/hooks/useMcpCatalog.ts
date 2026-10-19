import { useCallback, useMemo } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { useClawMcp } from '@/src/hooks/useClawMcp';
import type { McpServer } from '@/src/services/claw/clawMcpTypes';

export type McpCatalog = {
  servers: McpServer[];
  connectedServerIds: Set<string>;
  loading: boolean;
  isError: boolean;
  refetch: () => void;
  serverFor: (serverType: string) => McpServer | undefined;
};

/** Lightweight catalog for mcp_suggest Connect (servers + connected ids). */
export function useMcpCatalog(): McpCatalog {
  const { user } = useAuth();
  const userId = user?.user_id;
  const mcp = useClawMcp(userId, Boolean(userId));

  const servers = mcp.data?.servers ?? [];
  const connectedServerIds = useMemo(
    () => new Set((mcp.data?.connections ?? []).map(connection => connection.mcpServerId)),
    [mcp.data?.connections],
  );

  const serverFor = useCallback(
    (serverType: string): McpServer | undefined =>
      servers.find(server => server.type === serverType),
    [servers],
  );

  return {
    servers,
    connectedServerIds,
    loading: mcp.isLoading,
    isError: mcp.isError,
    refetch: (): void => {
      void mcp.refetch();
    },
    serverFor,
  };
}
