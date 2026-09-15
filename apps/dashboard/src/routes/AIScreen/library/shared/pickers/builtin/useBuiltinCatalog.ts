import { useMemo } from 'react';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { buildBuiltinCatalog, type BuiltinCatalogEntry } from './builtinCatalog';

export interface BuiltinCatalog {
  entries: BuiltinCatalogEntry[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useBuiltinCatalog(): BuiltinCatalog {
  const tools = useClawAvailableTools();

  const entries = useMemo(() => buildBuiltinCatalog(tools.data ?? null), [tools.data]);

  return {
    entries,
    loading: tools.isLoading,
    isError: tools.isError,
    refetch: () => void tools.refetch(),
  };
}
