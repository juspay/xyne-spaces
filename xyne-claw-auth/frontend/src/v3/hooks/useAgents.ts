import { useState, useEffect, useCallback } from "react";
import type { AgentLight } from "../../lib/types";
import { listAgents, listUserAgentConfigs } from "../../lib/api";

export type AgentProvider = "spaces" | "copilot" | "claude" | "codex" | string;

export interface UseAgentsReturn {
  agents: AgentLight[];
  providerMap: Record<string, AgentProvider>;
  loading: boolean;
  reload: () => void;
}

export function useAgents(userId: string): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [providerMap, setProviderMap] = useState<Record<string, AgentProvider>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await listAgents(userId);
      setAgents(fetched);

      const map: Record<string, AgentProvider> = {};
      for (const agent of fetched) {
        map[agent.slug] = "spaces";
      }
      const configs = await listUserAgentConfigs(userId).catch(() => []);
      for (const config of configs) {
        map[config.agentSlug] = config.provider as AgentProvider;
      }
      setProviderMap(map);
    } catch (err) {
      console.error("useAgents: failed to load agents", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { agents, providerMap, loading, reload: load };
}
