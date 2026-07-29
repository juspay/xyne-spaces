import { useState, useEffect, useCallback } from "react";
import { listSubagents } from "../../lib/api";
import type { SubagentDef } from "../../lib/api";

interface UseSubagentsReturn {
  subagents: SubagentDef[];
  builtIn: SubagentDef[];
  custom: SubagentDef[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function isBuiltIn(s: SubagentDef): boolean {
  return s.source === "builtin";
}

export function useSubagents(_userId: string): UseSubagentsReturn {
  const [subagents, setSubagents] = useState<SubagentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSubagents();
      setSubagents(list);
    } catch {
      setError("Failed to load subagents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const builtIn = subagents.filter(isBuiltIn);
  const custom = subagents.filter((s) => !isBuiltIn(s));

  return {
    subagents,
    builtIn,
    custom,
    loading,
    error,
    reload: load,
  };
}
