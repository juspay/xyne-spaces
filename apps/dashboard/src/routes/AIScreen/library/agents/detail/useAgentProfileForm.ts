import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { clawPromptVersionsKey } from '@/hooks/useClawPromptVersions';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { ClawApiError, clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  isFormDirty,
  type AgentCreateFormState,
} from '@/components/flowUI/nodes/agent/create/types';
import {
  buildUpdateAgentPayload,
  formFromAgent,
  instructionsFromSaved,
  validateHandle,
} from './agentProfileForm';

export interface AgentProfileForm {
  /** What the canvas shows: the edit in progress, or the agent as saved. */
  form: AgentCreateFormState;
  editing: boolean;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  /** Why Save can't go yet (name or handle), else null. */
  error: string | null;
  slugChanged: boolean;
  patch: (patch: Partial<AgentCreateFormState>) => void;
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  /** A prompt version was restored in Settings. */
  promptRestored: (systemPrompt: string) => void;
}

/**
 * The agent profile's Edit / Save. Read-only until Edit; Save sends only what
 * changed. While not editing the canvas follows the saved agent, so changes
 * made in Settings (or by someone else) show up.
 */
export function useAgentProfileForm(agent: Agent, canRenameHandle: boolean): AgentProfileForm {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const baseline = useMemo(() => formFromAgent(agent), [agent]);
  const [draft, setDraft] = useState<AgentCreateFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const form = draft ?? baseline;
  const slug = form.slug.trim().toLowerCase();
  const slugChanged = draft !== null && slug !== agent.slug;
  const dirty = draft !== null && isFormDirty(draft, baseline);
  const error =
    draft === null
      ? null
      : !form.name.trim()
        ? 'Name is required.'
        : slugChanged
          ? validateHandle(slug)
          : null;
  const canSave = dirty && !saving && !error;

  const save = async (): Promise<void> => {
    if (!draft || !canSave) return;
    const latest = queryClient.getQueryData<Agent>(clawAgentDetailKey(agent.slug)) ?? agent;
    const payload = buildUpdateAgentPayload(draft, baseline, latest.config ?? {}, canRenameHandle);
    const renaming = payload.slug !== undefined;
    setSaving(true);
    try {
      const updated = await updateClawAgent(agent.slug, payload);
      if (renaming) {
        queryClient.removeQueries({ queryKey: clawAgentDetailKey(agent.slug), exact: true });
      }
      queryClient.setQueryData(clawAgentDetailKey(updated.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      if (payload.systemPrompt !== undefined) {
        void queryClient.invalidateQueries({ queryKey: clawPromptVersionsKey(updated.slug) });
      }
      setDraft(null);
      toast.success('Changes saved');
      if (renaming) {
        const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
        void navigate(`${libraryPath}/agent/${updated.slug}`, { replace: true });
      }
    } catch (err) {
      if (renaming && err instanceof ClawApiError && err.status === 409) {
        toast.error(`The handle “${slug}” is already in use.`);
      } else {
        toast.error(clawErrorText(err, 'Could not save the changes'));
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    form,
    editing: draft !== null,
    saving,
    dirty,
    canSave,
    error,
    slugChanged,
    patch: next => setDraft(prev => (prev ? { ...prev, ...next } : prev)),
    start: () => setDraft(prev => prev ?? baseline),
    cancel: () => setDraft(null),
    save,
    promptRestored: (systemPrompt): void => {
      void queryClient.invalidateQueries({ queryKey: clawAgentDetailKey(agent.slug) });
      setDraft(prev =>
        prev ? { ...prev, systemPrompt: instructionsFromSaved(systemPrompt) } : prev,
      );
    },
  };
}
