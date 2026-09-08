import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import { readToolSelection } from '../../create/agentDraft';

export type ToolSelection = AgentToolboxSelection;

export type ManageSectionId = 'subagents' | 'mcp' | 'builtin';

export type ManageSection = ManageSectionId | null;

export interface AgentToolSelection {
  saved: ToolSelection;
  draft: ToolSelection;
  manage: ManageSection;
  saving: boolean;
  openManage: (section: ManageSectionId) => void;
  closeManage: () => void;
  setDraft: (next: ToolSelection) => void;
  commit: (next: ToolSelection, message: string) => void;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(entry => b.includes(entry));
}

export function selectionEqual(a: ToolSelection, b: ToolSelection): boolean {
  return (
    sameList(a.subagents, b.subagents) &&
    sameList(a.direct, b.direct) &&
    sameList(a.custom, b.custom) &&
    sameList(a.gateway, b.gateway) &&
    sameList(a.callableAgents, b.callableAgents)
  );
}

export function useAgentToolSelection(agent: Agent): AgentToolSelection {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [manage, setManage] = useState<ManageSection>(null);
  const [draft, setDraft] = useState<ToolSelection | null>(null);

  const saved = readToolSelection(agent.config ?? {});

  const persist = async (next: ToolSelection, message: string): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const previous = agent;
    const config = { ...(agent.config ?? {}), tools: next };
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, config });
    try {
      const updated = await updateClawAgent(agent.slug, { config });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(message);
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(clawErrorText(err, 'Could not update this agent'));
    } finally {
      setSaving(false);
    }
  };

  return {
    saved,
    draft: draft ?? saved,
    manage,
    saving,
    openManage: section => {
      setDraft(saved);
      setManage(section);
    },
    closeManage: () => {
      const next = draft;
      setManage(null);
      setDraft(null);
      if (next && !selectionEqual(next, saved)) void persist(next, 'Tools updated');
    },
    setDraft,
    commit: (next, message) => void persist(next, message),
  };
}
