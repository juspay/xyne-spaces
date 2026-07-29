import { useState, useEffect, useCallback } from "react";
import { getSubagent, listSubagentShares } from "../../lib/api";
import type { SubagentDef, SubagentShareEntry } from "../../lib/api";

interface UseSubagentDetailReturn {
  subagent: SubagentDef | null;
  shares: SubagentShareEntry[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSubagentDetail(
  name: string | undefined,
  _userId: string,
): UseSubagentDetailReturn {
  const [subagent, setSubagent] = useState<SubagentDef | null>(null);
  const [shares, setShares] = useState<SubagentShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [subagentRes, sharesRes] = await Promise.allSettled([
        getSubagent(name),
        listSubagentShares(name).catch(() => [] as SubagentShareEntry[]),
      ]);

      if (subagentRes.status === "fulfilled") {
        setSubagent(subagentRes.value);
      } else {
        setError("Failed to load subagent");
      }

      if (sharesRes.status === "fulfilled") {
        setShares(sharesRes.value);
      }
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    subagent,
    shares,
    loading,
    error,
    reload: load,
  };
}
