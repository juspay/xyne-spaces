import { useMemo } from 'react';
import type { UserConnection } from '@/services/claw/clawMcpTypes';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawMcp } from '@/hooks/useClawMcp';
import { buildMcpCatalog, type McpCatalogEntry } from './mcpCatalog';

export interface McpCatalog {
  entries: McpCatalogEntry[];
  connectedServerIds: Set<string>;
  /** The live connection per server, for actions that need its id (disconnect, health). */
  connectionsByServerId: Map<string, UserConnection>;
  loading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useMcpCatalog(): McpCatalog {
  const tools = useClawAvailableTools();
  const mcp = useClawMcp();

  const entries = useMemo(
    () => buildMcpCatalog(tools.data ?? null, mcp.data?.servers ?? []),
    [tools.data, mcp.data?.servers],
  );

  const connectedServerIds = useMemo(
    () => new Set((mcp.data?.connections ?? []).map(connection => connection.mcpServerId)),
    [mcp.data?.connections],
  );

  const connectionsByServerId = useMemo(
    () =>
      new Map(
        (mcp.data?.connections ?? []).map(connection => [connection.mcpServerId, connection]),
      ),
    [mcp.data?.connections],
  );

  return {
    entries,
    connectedServerIds,
    connectionsByServerId,
    loading: tools.isLoading,
    isError: tools.isError,
    refetch: (): void => {
      void tools.refetch();
      void mcp.refetch();
    },
  };
}
