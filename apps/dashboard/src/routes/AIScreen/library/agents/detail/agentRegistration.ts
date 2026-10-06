import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export function isSpacesRegistered(agent: Agent): boolean {
  return Boolean(
    agent.spacesAppId ||
    agent.spacesAppUserId ||
    agent.spacesAppToken ||
    agent.spacesAppTokenConfigured,
  );
}
