import { useState, useEffect, useCallback } from "react";
import type { Agent } from "../../lib/types";
import { listAgents, getUserAgentConfig } from "../../lib/api";

export type AgentProvider = "spaces" | "copilot" | "claude" | "codex" | string;

export interface UseAgentsReturn {
  agents: Agent[];
  providerMap: Record<string, AgentProvider>;
  loading: boolean;
  reload: () => void;
}

export function useAgents(userId: string): UseAgentsReturn {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providerMap, setProviderMap] = useState<Record<string, AgentProvider>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await listAgents(userId);
      setAgents(fetched);

      const configs = await Promise.all(
        fetched.map(async (agent) => {
          try {
            const config = await getUserAgentConfig(agent.slug, userId);
            return { slug: agent.slug, provider: config.provider as AgentProvider };
          } catch {
            return { slug: agent.slug, provider: "spaces" as AgentProvider };
          }
        }),
      );

      const map: Record<string, AgentProvider> = {};
      for (const { slug, provider } of configs) {
        map[slug] = provider;
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
