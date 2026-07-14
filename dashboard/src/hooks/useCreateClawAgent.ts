import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { createAgent, updateAgent } from '../services/claw/clawAgentWizardService';
import type { Agent } from '../services/claw/clawAuthAgentTypes';
import type { KbSelection } from '../services/claw/clawKnowledgeBaseTypes';
import type { ToolboxSelection } from '../services/claw/clawToolsTypes';

export interface WizardSubmission {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  kbScope: 'COLLECTIONS' | 'USER';
  knowledgeBase: KbSelection[];
  tools: Required<ToolboxSelection>;
  skillIds: string[];
  research: { productId: string; repositoryId: string };
}

/**
 * Raised when the agent was created but the follow-up config PUT (tools/skills)
 * failed. The agent EXISTS, so retrying create would trip the name check — we
 * carry its slug so the caller can send the user to the detail screen instead.
 */
export class AgentConfigAttachError extends Error {
  readonly slug: string;

  constructor(slug: string, message: string) {
    super(message);
    this.name = 'AgentConfigAttachError';
    this.slug = slug;
  }
}

/** Research context is active when a research subagent tool or a pin is chosen. */
function hasResearchConfig(s: WizardSubmission): boolean {
  return (
    s.tools.custom.includes('query-codebase') ||
    s.tools.custom.includes('review-pull-request') ||
    Boolean(s.research.productId) ||
    Boolean(s.research.repositoryId)
  );
}

/**
 * Two-phase agent creation: POST /agents, then (only if tools/skills/research
 * were chosen) PUT /agents/:slug with the config. On success, invalidate the
 * agent list and route to the new agent's detail screen.
 */
export const useCreateClawAgent = (): UseMutationResult<Agent, Error, WizardSubmission> => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<Agent, Error, WizardSubmission>({
    mutationFn: async s => {
      const isUserScopedKb = s.kbScope === 'USER';
      const agent = await createAgent({
        slug: s.slug,
        name: s.name,
        description: s.description,
        systemPrompt: s.systemPrompt,
        color: s.color,
        kbScope: s.kbScope,
        ...(userId ? { ownerUserId: userId } : {}),
        ...(isUserScopedKb || s.knowledgeBase.length === 0
          ? {}
          : { knowledgeBase: s.knowledgeBase }),
      });

      const hasTools =
        s.tools.subagents.length > 0 ||
        s.tools.direct.length > 0 ||
        s.tools.custom.length > 0 ||
        s.tools.gateway.length > 0;
      const hasSkills = s.skillIds.length > 0;
      const hasResearch = hasResearchConfig(s);

      if (hasTools || hasSkills || hasResearch) {
        const config: Record<string, unknown> = {};
        if (hasTools) {
          config['tools'] = {
            subagents: s.tools.subagents,
            direct: s.tools.direct,
            custom: s.tools.custom,
            gateway: s.tools.gateway,
          };
        }
        if (hasResearch) {
          config['product_id'] = s.research.productId || null;
          config['repository_id'] = s.research.repositoryId || null;
        }
        try {
          await updateAgent(agent.slug, {
            ...(Object.keys(config).length > 0 ? { config } : {}),
            ...(hasSkills ? { skills: s.skillIds } : {}),
          });
        } catch (err) {
          throw new AgentConfigAttachError(
            agent.slug,
            err instanceof Error ? err.message : 'Failed to attach tools and skills',
          );
        }
      }

      return agent;
    },
    onSuccess: agent => {
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents', userId] });
      toast.success('Agent created');
      void navigate(`/claw-agents/agents/${agent.slug}?tab=persona`);
    },
    onError: err => {
      // Agent exists but config failed: land the user on the detail screen so
      // they can finish attaching tools there (retrying create would 409).
      if (err instanceof AgentConfigAttachError) {
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents', userId] });
        toast.error(
          'Agent created, but tools and skills could not be attached — add them from the agent page.',
        );
        void navigate(`/claw-agents/agents/${err.slug}?tab=persona`);
      }
      // Plain create failures surface via the mutation's `error` (Review step box).
    },
  });
};
