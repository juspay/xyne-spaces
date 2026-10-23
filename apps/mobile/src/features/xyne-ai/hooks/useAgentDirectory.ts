import { useMemo } from 'react';

import { buildAgentDirectory, type AgentDirectory } from '../model/agentIdentity';
import { useXyneAIAgents } from './useXyneAICatalog';

const NO_AGENTS: never[] = [];

/**
 * Agent identities for history rows. Reads the same cached query the agent
 * picker uses, so it adds no request; while it loads or if it fails, rows fall
 * back to a letter tile instead of waiting.
 */
export function useAgentDirectory(): AgentDirectory {
  const { data } = useXyneAIAgents();
  const agents = data ?? NO_AGENTS;
  return useMemo(() => buildAgentDirectory(agents), [agents]);
}
