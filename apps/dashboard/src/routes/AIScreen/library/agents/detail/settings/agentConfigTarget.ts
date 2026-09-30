import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

/**
 * Where a settings card reads and writes the agent's `config`: a saved agent
 * (every change goes to the API straight away) or the agent being created (the
 * change stays in the draft and goes out with Save).
 */
export interface AgentConfigTarget {
  config: Record<string, unknown>;
  /** Writes a whole new config. False when it didn't stick; the error is already shown. */
  save: (config: Record<string, unknown>, message: string, failure?: string) => Promise<boolean>;
}

/** A saved agent: optimistic, rolled back (with a toast) when the update fails. */
export function useSavedAgentConfig(agent: Agent): AgentConfigTarget {
  const queryClient = useQueryClient();
  return {
    config: agent.config ?? {},
    save: async (config, message, failure = 'Could not update this agent'): Promise<boolean> => {
      const key = clawAgentDetailKey(agent.slug);
      const previous = queryClient.getQueryData<Agent>(key) ?? agent;
      queryClient.setQueryData(key, { ...previous, config });
      try {
        const updated = await updateClawAgent(agent.slug, { config });
        queryClient.setQueryData(key, updated);
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
        toast.success(message);
        return true;
      } catch (err) {
        queryClient.setQueryData(key, previous);
        toast.error(clawErrorText(err, failure));
        return false;
      }
    },
  };
}

/** The agent being created: changes land in the draft, no toast (nothing was saved yet). */
export function draftConfigTarget(
  config: Record<string, unknown>,
  onChange: (config: Record<string, unknown>) => void,
): AgentConfigTarget {
  return {
    config,
    save: (next): Promise<boolean> => {
      onChange(next);
      return Promise.resolve(true);
    },
  };
}
