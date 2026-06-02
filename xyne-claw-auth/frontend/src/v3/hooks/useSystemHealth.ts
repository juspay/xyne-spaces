import { useState, useEffect, useCallback, useRef } from "react";
import { getSystemHealth } from "../../lib/api";

export type SystemHealthStatus = "ok" | "degraded" | "critical";

export interface SystemHealth {
  status: SystemHealthStatus;
  message: string;
}

export interface UseSystemHealthReturn {
  health: SystemHealth;
  loading: boolean;
  reload: () => void;
}

export function useSystemHealth(): UseSystemHealthReturn {
  const [health, setHealth] = useState<SystemHealth>({
    status: "ok",
    message: "All systems operational",
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSystemHealth();
      setHealth(data);
    } catch (err) {
      console.error("useSystemHealth: failed to load health", err);
      setHealth({
        status: "critical",
        message: "Unable to reach health endpoint",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh every 30s to keep status current
    const interval = setInterval(() => {
      void load();
    }, 30000);
    return () => clearInterval(interval);
  }, [load]);

  return { health, loading, reload: load };
}
