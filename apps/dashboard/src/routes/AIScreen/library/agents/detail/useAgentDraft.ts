import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { clawPromptVersionsKey } from '@/hooks/useClawPromptVersions';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { ClawApiError, clawErrorText } from '@/services/claw/clawRequest';
import type { Agent, UpdateAgentPayload } from '@/services/claw/clawAuthAgentTypes';

const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validateHandle(handle: string): string | null {
  if (!handle) return 'Handle is required.';
  if (handle.length < 2) return 'Handle must be at least 2 characters.';
  if (handle.length > 64) return 'Handle must be 64 characters or fewer.';
  if (!HANDLE_REGEX.test(handle)) {
    return 'Use lowercase letters, digits, and hyphens, with no leading or trailing hyphen.';
  }
  return null;
}

export interface AgentDraft {
  editing: boolean;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  slugError: string | null;
  slugChanged: boolean;
  setName: (value: string) => void;
  setSlug: (value: string) => void;
  setDescription: (value: string) => void;
  setSystemPrompt: (value: string) => void;
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
}

export function useAgentDraft(agent: Agent | undefined, canRenameHandle: boolean): AgentDraft {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedSlug, setLoadedSlug] = useState(agent?.slug ?? '');
  const [name, setName] = useState(agent?.name ?? '');
  const [slug, setSlug] = useState(agent?.slug ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');

  if (agent && loadedSlug !== agent.slug) {
    setLoadedSlug(agent.slug);
    setName(agent.name);
    setSlug(agent.slug);
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt ?? '');
    setEditing(false);
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const slugChanged = Boolean(agent) && normalizedSlug !== agent?.slug;
  const nameChanged = Boolean(agent) && name !== agent?.name;
  const descriptionChanged = Boolean(agent) && description !== agent?.description;
  const promptChanged = Boolean(agent) && systemPrompt !== (agent?.systemPrompt ?? '');
  const dirty = nameChanged || descriptionChanged || promptChanged || slugChanged;

  const slugError = slugChanged ? validateHandle(normalizedSlug) : null;
  const nameError = nameChanged && !name.trim() ? 'Name is required.' : null;
  const canSave = dirty && !saving && !slugError && !nameError;

  const reset = (): void => {
    if (!agent) return;
    setName(agent.name);
    setSlug(agent.slug);
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt ?? '');
  };

  const start = (): void => setEditing(true);

  const cancel = (): void => {
    reset();
    setEditing(false);
  };

  const save = async (): Promise<void> => {
    if (!agent || !canSave) return;
    setSaving(true);
    const payload: UpdateAgentPayload = {
      ...(nameChanged ? { name: name.trim() } : {}),
      ...(descriptionChanged ? { description } : {}),
      ...(promptChanged ? { systemPrompt } : {}),
      ...(slugChanged && canRenameHandle ? { slug: normalizedSlug } : {}),
    };
    const renaming = slugChanged && canRenameHandle;
    try {
      const updated = await updateClawAgent(agent.slug, payload);
      if (renaming) {
        queryClient.removeQueries({ queryKey: clawAgentDetailKey(agent.slug), exact: true });
        queryClient.setQueryData(clawAgentDetailKey(updated.slug), updated);
      } else {
        queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      }
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      if (promptChanged) {
        void queryClient.invalidateQueries({ queryKey: clawPromptVersionsKey(updated.slug) });
      }
      setLoadedSlug(updated.slug);
      setName(updated.name);
      setSlug(updated.slug);
      setDescription(updated.description);
      setSystemPrompt(updated.systemPrompt ?? '');
      setEditing(false);
      toast.success('Changes saved');
      if (renaming) {
        const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
        void navigate(`${libraryPath}/agent/${updated.slug}?tab=persona`, { replace: true });
      }
    } catch (err) {
      if (renaming && err instanceof ClawApiError && err.status === 409) {
        toast.error(`The handle “${normalizedSlug}” is already in use.`);
      } else {
        toast.error(clawErrorText(err, 'Could not save the changes'));
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    editing,
    saving,
    dirty,
    canSave,
    name,
    slug,
    description,
    systemPrompt,
    slugError: slugError ?? nameError,
    slugChanged,
    setName,
    setSlug,
    setDescription,
    setSystemPrompt,
    start,
    cancel,
    save,
  };
}
