import { useState, type FocusEvent, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button/index';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { clawPromptVersionsKey } from '@/hooks/useClawPromptVersions';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import { PROSE_BOX_HEIGHT, ProseBox } from '../../../shared/primitives/ProseBox';
import { AgentPromptVersions } from './AgentPromptVersions';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import type { Agent, UpdateAgentPayload } from '@/services/claw/clawAuthAgentTypes';
import {
  DetailCard,
  DetailEmpty,
  DetailProse,
  DetailSection,
} from '../../../shared/primitives/DetailPrimitives';

const EDITOR =
  'w-full rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring';

function focusAtEnd(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
  el.scrollTop = el.scrollHeight;
}

function ClickToEdit({
  enabled,
  label,
  onEdit,
  children,
}: {
  enabled: boolean;
  label: string;
  onEdit: () => void;
  children: ReactElement;
}): ReactElement {
  if (!enabled) return children;
  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={label}
      onClick={onEdit}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit();
        }
      }}
      data-track-category='Claw Agents'
      data-track-name={`Agent detail v2: ${label}`}
      className='w-full cursor-text rounded-2xl focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
    >
      {children}
    </div>
  );
}

export function AgentPersonaTabV2({
  agent,
  canEdit,
  canManageCredentials,
}: {
  agent: Agent;
  canEdit: boolean;
  canManageCredentials: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const [loadedSlug, setLoadedSlug] = useState(agent.slug);
  const [description, setDescription] = useState(agent.description);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [saving, setSaving] = useState(false);

  if (loadedSlug !== agent.slug) {
    setLoadedSlug(agent.slug);
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt);
    setEditingDescription(false);
    setEditingPrompt(false);
  }

  const descriptionChanged = description !== agent.description;
  const promptChanged = systemPrompt !== agent.systemPrompt;
  const dirty = descriptionChanged || promptChanged;

  const collapseOnOutsideFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setEditingDescription(false);
    setEditingPrompt(false);
  };

  const cancel = (): void => {
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt);
    setEditingDescription(false);
    setEditingPrompt(false);
  };

  const save = async (): Promise<void> => {
    if (!dirty || saving) return;
    setSaving(true);
    const payload: UpdateAgentPayload = {
      ...(descriptionChanged ? { description } : {}),
      ...(promptChanged ? { systemPrompt } : {}),
    };
    try {
      const updated = await updateClawAgent(agent.slug, payload);
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      if (promptChanged) {
        void queryClient.invalidateQueries({ queryKey: clawPromptVersionsKey(agent.slug) });
      }
      setDescription(updated.description);
      setSystemPrompt(updated.systemPrompt);
      setEditingDescription(false);
      setEditingPrompt(false);
      toast.success('Changes saved');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not save the changes'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex w-full flex-col gap-8'>
      <div className='flex w-full flex-col gap-8' onBlur={collapseOnOutsideFocus}>
        <DetailSection label='Description' info='What this agent is for'>
          {canEdit && editingDescription ? (
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder='Add a description so people and agents understand when to use it.'
              aria-label='Agent description'
              ref={focusAtEnd}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit description'
              className={`${EDITOR} h-[86px] resize-y`}
            />
          ) : (
            <ClickToEdit
              enabled={canEdit}
              label='Edit description'
              onEdit={() => setEditingDescription(true)}
            >
              <DetailCard>
                {description ? (
                  <DetailProse>{description}</DetailProse>
                ) : (
                  <DetailEmpty>No description added</DetailEmpty>
                )}
              </DetailCard>
            </ClickToEdit>
          )}
        </DetailSection>

        <DetailSection label='System Prompt' info='The instructions this agent runs with'>
          {canEdit && editingPrompt ? (
            <textarea
              value={systemPrompt}
              onChange={event => setSystemPrompt(event.target.value)}
              placeholder='Describe how this agent should behave.'
              aria-label='Agent system prompt'
              ref={focusAtEnd}
              style={{ height: PROSE_BOX_HEIGHT }}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit system prompt'
              className={`${EDITOR} resize-y`}
            />
          ) : (
            <ClickToEdit
              enabled={canEdit}
              label='Edit system prompt'
              onEdit={() => setEditingPrompt(true)}
            >
              {systemPrompt ? (
                <ProseBox>{systemPrompt}</ProseBox>
              ) : (
                <DetailCard>
                  <DetailEmpty>No system prompt set</DetailEmpty>
                </DetailCard>
              )}
            </ClickToEdit>
          )}

          {canEdit && (editingDescription || editingPrompt || dirty) && (
            <div className='flex w-full items-center justify-end gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={cancel}
                disabled={saving}
                className='rounded-lg'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: cancel persona edits'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={() => void save()}
                disabled={!dirty}
                loading={saving}
                className='rounded-lg'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: save persona edits'
              >
                Save
              </Button>
            </div>
          )}
        </DetailSection>
      </div>

      {canManageCredentials && (
        <AgentPromptVersions
          agentSlug={agent.slug}
          canRestore={canEdit}
          onRestored={restored => {
            setSystemPrompt(restored);
            setEditingPrompt(false);
          }}
        />
      )}

      <ModelCard agent={agent} canEdit={canEdit} />

      <CredentialsCard slug={agent.slug} canRead={canEdit} canManage={canManageCredentials} />
    </div>
  );
}
