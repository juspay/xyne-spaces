import { useState, useEffect, useCallback, useMemo } from "react";
import { listSkills, listAgentsFull } from "../../lib/api";
import type { Skill } from "../../lib/api";
import type { Agent } from "../../lib/types";

interface UseSkillsReturn {
  skills: Skill[];
  agents: Agent[];
  agentsBySkill: Record<string, Agent[]>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetches skills and agents in parallel so the UI can compute
 * how many agents use each skill.
 */
export function useSkills(userId: string): UseSkillsReturn {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillList, agentList] = await Promise.all([
        listSkills(userId),
        listAgentsFull(userId),
      ]);
      setSkills(skillList);
      setAgents(agentList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const agentsBySkill = useMemo(() => {
    const map: Record<string, Agent[]> = {};
    agents.forEach((agent) => {
      (agent.skills ?? []).forEach((as) => {
        const list = map[as.skillId] ?? (map[as.skillId] = []);
        list.push(agent);
      });
    });
    return map;
  }, [agents]);

  return { skills, agents, agentsBySkill, loading, error, reload };
}
