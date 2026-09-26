import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import { useOptimisticSave } from '../../../shared/hooks/useOptimisticSave';
import { readToolSelection } from '../../create/agentDraft';

export type ToolSelection = AgentToolboxSelection;

export type ManageSectionId = 'subagents' | 'mcp' | 'builtin';

export type ManageSection = ManageSectionId | null;

const TOAST_ID = 'agent-tools-save';

export interface AgentToolSelection {
  saved: ToolSelection;
  manage: ManageSection;
  saving: boolean;
  openManage: (section: ManageSectionId) => void;
  closeManage: () => void;
  commit: (next: ToolSelection, message: string) => void;
}

export function useAgentToolSelection(agent: Agent): AgentToolSelection {
  const queryClient = useQueryClient();
  const tools = useOptimisticSave<ToolSelection>(readToolSelection(agent.config ?? {}));
  const [manage, setManage] = useState<ManageSection>(null);

  const commit = (next: ToolSelection, message: string): void => {
    tools.save(next, async () => {
      const key = clawAgentDetailKey(agent.slug);
      const previous = queryClient.getQueryData<Agent>(key) ?? agent;
      const config = { ...(previous.config ?? {}), tools: next };
      queryClient.setQueryData(key, { ...previous, config });
      try {
        const updated = await updateClawAgent(agent.slug, { config });
        queryClient.setQueryData(key, updated);
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
        toast.success(message, { id: TOAST_ID });
      } catch (err) {
        queryClient.setQueryData(key, previous);
        toast.error(clawErrorText(err, 'Could not update this agent'), { id: TOAST_ID });
      }
    });
  };

  return {
    saved: tools.value,
    manage,
    saving: tools.saving,
    openManage: section => setManage(section),
    closeManage: () => setManage(null),
    commit,
  };
}
