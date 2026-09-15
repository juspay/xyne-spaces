import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { WizardState } from '../../../../ClawAgentsScreen/create/wizardState';

export interface SaveClawAgent {
  save: (state: WizardState) => Promise<void>;
  saving: boolean;
}

export function useSaveClawAgent(agent: Agent | undefined): SaveClawAgent {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [saving, setSaving] = useState(false);

  const save = async (state: WizardState): Promise<void> => {
    if (!agent || saving) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = {
        ...(agent.config ?? {}),
        tools: {
          subagents: state.tools.subagents,
          direct: state.tools.direct,
          custom: state.tools.custom,
          gateway: state.tools.gateway,
          callableAgents: state.tools.callableAgents,
        },
      };
      if (state.researchAgentProductId) config['product_id'] = state.researchAgentProductId;
      if (state.researchAgentRepositoryId)
        config['repository_id'] = state.researchAgentRepositoryId;

      const updated = await updateClawAgent(agent.slug, {
        name: state.name.trim(),
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        color: state.color,
        kbScope: state.selectedKbScope,
        ...(state.selectedKbScope === 'USER' ? {} : { knowledgeBase: state.selectedKbResources }),
        config,
        skills: state.selectedSkillIds,
      });

      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success('Changes saved');

      const base = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
      void navigate(`${base}/agent/${agent.slug}?tab=persona`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not save this agent'));
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
}
