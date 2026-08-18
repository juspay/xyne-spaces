import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { ProseBox } from '../../../shared/primitives/ProseBox';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  DETAIL_TEXT_FIELD_CLASS,
  DETAIL_TEXT_VALUE_CLASS,
  DetailEmpty,
  DetailProse,
  DetailSection,
  DetailStack,
  DetailTextField,
} from '../../../shared/primitives/DetailPrimitives';

export function AgentPersonaTabV2({
  agent,
  canEdit,
  canManageCredentials,
  showDescriptionAndPrompt = true,
}: {
  agent: Agent;
  canEdit: boolean;
  canManageCredentials: boolean;
  showDescriptionAndPrompt?: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState(agent.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? '');
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingSystemPrompt, setSavingSystemPrompt] = useState(false);

  useEffect(() => {
    if (document.activeElement !== descriptionRef.current) {
      setDescription(agent.description ?? '');
    }
  }, [agent.description]);

  useEffect(() => {
    if (document.activeElement !== systemPromptRef.current) {
      setSystemPrompt(agent.systemPrompt ?? '');
    }
  }, [agent.systemPrompt]);

  const persistDescription = async (): Promise<void> => {
    if (savingDescription || description === agent.description) return;
    setSavingDescription(true);
    try {
      const updated = await updateClawAgent(agent.slug, { description });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      toast.success('Description saved');
    } catch (error) {
      toast.error(clawErrorText(error, 'Could not save the description'));
    } finally {
      setSavingDescription(false);
    }
  };

  const persistSystemPrompt = async (): Promise<void> => {
    if (savingSystemPrompt || systemPrompt === (agent.systemPrompt ?? '')) return;
    setSavingSystemPrompt(true);
    try {
      const updated = await updateClawAgent(agent.slug, { systemPrompt });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      toast.success('System prompt saved');
    } catch (error) {
      toast.error(clawErrorText(error, 'Could not save the system prompt'));
    } finally {
      setSavingSystemPrompt(false);
    }
  };

  return (
    <DetailStack gap='page'>
      {showDescriptionAndPrompt && (
        <DetailStack>
          <DetailSection label='Description' info='What this agent is for' heading='field'>
            {canEdit ? (
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={event => setDescription(event.target.value)}
                onBlur={() => void persistDescription()}
                aria-label='Description'
                aria-busy={savingDescription}
                placeholder='Add a description'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: edit description'
                className={cn(
                  DETAIL_TEXT_FIELD_CLASS,
                  DETAIL_TEXT_VALUE_CLASS,
                  'h-[86px] resize-y overflow-auto placeholder:text-foreground/40 focus:outline-none',
                )}
              />
            ) : (
              <DetailTextField className='min-h-[86px]'>
                {agent.description ? (
                  <DetailProse>{agent.description}</DetailProse>
                ) : (
                  <DetailEmpty>No description added</DetailEmpty>
                )}
              </DetailTextField>
            )}
          </DetailSection>

          <DetailSection
            label='System Prompt'
            info='The instructions this agent runs with'
            heading='field'
          >
            {canEdit ? (
              <textarea
                ref={systemPromptRef}
                value={systemPrompt}
                onChange={event => setSystemPrompt(event.target.value)}
                onBlur={() => void persistSystemPrompt()}
                aria-label='System Prompt'
                aria-busy={savingSystemPrompt}
                placeholder='Add a system prompt'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: edit system prompt'
                className={cn(
                  DETAIL_TEXT_FIELD_CLASS,
                  DETAIL_TEXT_VALUE_CLASS,
                  'block h-[298px] resize-none overflow-y-auto placeholder:text-foreground/40 transition-[height,border-color,box-shadow] duration-200 ease-out focus:h-[400px] focus:outline-none',
                )}
              />
            ) : agent.systemPrompt ? (
              <ProseBox>{agent.systemPrompt}</ProseBox>
            ) : (
              <DetailTextField>
                <DetailEmpty>No system prompt set</DetailEmpty>
              </DetailTextField>
            )}
          </DetailSection>
        </DetailStack>
      )}

      <ModelCard agent={agent} canEdit={canEdit} />

      <CredentialsCard slug={agent.slug} canRead={canEdit} canManage={canManageCredentials} />
    </DetailStack>
  );
}
