import { useMemo } from 'react';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawMcp } from '@/hooks/useClawMcp';
import { buildMcpCatalog, type McpCatalogEntry } from './mcpCatalog';

export interface McpCatalog {
  entries: McpCatalogEntry[];
  connectedServerIds: Set<string>;
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

  return {
    entries,
    connectedServerIds,
    loading: tools.isLoading,
    isError: tools.isError,
    refetch: () => void tools.refetch(),
  };
}
