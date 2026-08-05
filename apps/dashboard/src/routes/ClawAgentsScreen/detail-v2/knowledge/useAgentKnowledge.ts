import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent, UpdateAgentPayload } from '@/services/claw/clawAuthAgentTypes';
import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { KbScope } from '../../create-v2/knowledge/knowledgeCatalog';

export type KnowledgeSection = 'skills' | 'documents' | null;

export interface AgentKnowledge {
  skillIds: string[];
  scope: KbScope;
  grants: KbSelection[];
  draftSkillIds: string[];
  draftScope: KbScope;
  draftGrants: KbSelection[];
  browse: KnowledgeSection;
  saving: boolean;
  openBrowse: (section: Exclude<KnowledgeSection, null>) => void;
  closeBrowse: () => void;
  setDraftSkillIds: (next: string[]) => void;
  setDraftScope: (next: KbScope) => void;
  setDraftGrants: (next: KbSelection[]) => void;
  saveSkills: (next: string[], message: string) => void;
  saveKb: (scope: KbScope, grants: KbSelection[], message: string) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(id => b.includes(id));
}

function grantKey(grant: KbSelection): string {
  return `${grant.collectionId}:${grant.fileId ?? '*'}`;
}

function sameGrants(a: readonly KbSelection[], b: readonly KbSelection[]): boolean {
  const keys = new Set(b.map(grantKey));
  return a.length === b.length && a.every(grant => keys.has(grantKey(grant)));
}

export function useAgentKnowledge(agent: Agent): AgentKnowledge {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [browse, setBrowse] = useState<KnowledgeSection>(null);
  const [draft, setDraft] = useState<{
    skillIds: string[];
    scope: KbScope;
    grants: KbSelection[];
  } | null>(null);

  const skillIds = (agent.skills ?? []).map(entry => entry.skillId);
  const scope: KbScope = agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS';
  const grants: KbSelection[] = (agent.collections ?? []).map(entry => ({
    collectionId: entry.collectionId,
    ...(entry.fileId ? { fileId: entry.fileId } : {}),
  })) as KbSelection[];

  const persist = async (payload: UpdateAgentPayload, message: string): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const previous = agent;
    try {
      const updated = await updateClawAgent(agent.slug, payload);
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

  // A USER-scoped agent follows the running user's own access, so no grants are
  // sent — matching what the create flow writes.
  const kbPayload = (nextScope: KbScope, nextGrants: KbSelection[]): UpdateAgentPayload => ({
    kbScope: nextScope,
    ...(nextScope === 'USER' ? {} : { knowledgeBase: nextGrants }),
  });

  return {
    skillIds,
    scope,
    grants,
    draftSkillIds: draft?.skillIds ?? skillIds,
    draftScope: draft?.scope ?? scope,
    draftGrants: draft?.grants ?? grants,
    browse,
    saving,
    openBrowse: section => {
      setDraft({ skillIds, scope, grants });
      setBrowse(section);
    },
    closeBrowse: () => {
      const next = draft;
      const section = browse;
      setBrowse(null);
      setDraft(null);
      if (!next) return;
      if (section === 'skills' && !sameIds(next.skillIds, skillIds)) {
        void persist({ skills: next.skillIds }, 'Skills updated');
      }
      if (section === 'documents' && (next.scope !== scope || !sameGrants(next.grants, grants))) {
        void persist(kbPayload(next.scope, next.grants), 'Documents updated');
      }
    },
    setDraftSkillIds: next =>
      setDraft(current => ({ ...(current ?? { scope, grants }), skillIds: next })),
    setDraftScope: next =>
      setDraft(current => ({ ...(current ?? { skillIds, grants }), scope: next })),
    setDraftGrants: next =>
      setDraft(current => ({ ...(current ?? { skillIds, scope }), grants: next })),
    saveSkills: (next, message) => void persist({ skills: next }, message),
    saveKb: (nextScope, nextGrants, message) =>
      void persist(kbPayload(nextScope, nextGrants), message),
  };
}
