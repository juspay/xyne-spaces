import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent, UpdateAgentPayload } from '@/services/claw/clawAuthAgentTypes';
import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { useOptimisticSave } from '../../../shared/hooks/useOptimisticSave';
import type { KbScope } from '../../../shared/pickers/knowledge/knowledgeCatalog';

export type KnowledgeSection = 'skills' | 'documents' | null;

const TOAST_ID = 'agent-knowledge-save';

interface KnowledgeState {
  skillIds: string[];
  scope: KbScope;
  grants: KbSelection[];
}

export interface AgentKnowledge {
  skillIds: string[];
  scope: KbScope;
  grants: KbSelection[];
  browse: KnowledgeSection;
  saving: boolean;
  openBrowse: (section: Exclude<KnowledgeSection, null>) => void;
  closeBrowse: () => void;
  saveSkills: (next: string[], message: string) => void;
  saveKb: (scope: KbScope, grants: KbSelection[], message: string) => void;
}

export function useAgentKnowledge(agent: Agent): AgentKnowledge {
  const queryClient = useQueryClient();
  const [browse, setBrowse] = useState<KnowledgeSection>(null);

  const committed: KnowledgeState = {
    skillIds: (agent.skills ?? []).map(entry => entry.skillId),
    scope: agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS',
    grants: (agent.collections ?? []).map(entry => ({
      collectionId: entry.collectionId,
      ...(entry.fileId ? { fileId: entry.fileId } : {}),
    })) as KbSelection[],
  };

  const knowledge = useOptimisticSave<KnowledgeState>(committed);

  const persist = (next: KnowledgeState, payload: UpdateAgentPayload, message: string): void => {
    knowledge.save(next, async () => {
      const key = clawAgentDetailKey(agent.slug);
      const previous = queryClient.getQueryData<Agent>(key) ?? agent;
      try {
        const updated = await updateClawAgent(agent.slug, payload);
        queryClient.setQueryData(key, updated);
        void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
        toast.success(message, { id: TOAST_ID });
      } catch (err) {
        queryClient.setQueryData(key, previous);
        toast.error(clawErrorText(err, 'Could not update this agent'), { id: TOAST_ID });
      }
    });
  };

  // A USER-scoped agent follows the running user's own access, so no grants are
  // sent — matching what the create flow writes.
  const kbPayload = (nextScope: KbScope, nextGrants: KbSelection[]): UpdateAgentPayload => ({
    kbScope: nextScope,
    ...(nextScope === 'USER' ? {} : { knowledgeBase: nextGrants }),
  });

  return {
    skillIds: knowledge.value.skillIds,
    scope: knowledge.value.scope,
    grants: knowledge.value.grants,
    browse,
    saving: knowledge.saving,
    openBrowse: section => setBrowse(section),
    closeBrowse: () => setBrowse(null),
    saveSkills: (next, message) =>
      persist({ ...knowledge.value, skillIds: next }, { skills: next }, message),
    saveKb: (nextScope, nextGrants, message) =>
      persist(
        { ...knowledge.value, scope: nextScope, grants: nextGrants },
        kbPayload(nextScope, nextGrants),
        message,
      ),
  };
}
