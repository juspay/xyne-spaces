import { useMemo } from 'react';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawSubagents } from '@/hooks/useClawSubagents';
import { buildSubagentCatalog, type SubagentCatalogEntry } from './subagentCatalog';

export interface SubagentCatalog {
  entries: SubagentCatalogEntry[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useSubagentCatalog(): SubagentCatalog {
  const tools = useClawAvailableTools();
  const subagents = useClawSubagents();

  const entries = useMemo(
    () => buildSubagentCatalog(tools.data ?? null, subagents.data ?? []),
    [tools.data, subagents.data],
  );

  return {
    entries,
    loading: tools.isLoading,
    isError: tools.isError,
    refetch: () => void tools.refetch(),
  };
}
