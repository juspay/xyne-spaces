import { useState, useEffect, useCallback } from "react";
import { listGateways } from "../../lib/api";
import type { Gateway } from "../../lib/types";

interface UseGatewaysReturn {
  gateways: Gateway[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useGateways(): UseGatewaysReturn {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listGateways();
      setGateways(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gateways");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { gateways, loading, error, reload };
}
