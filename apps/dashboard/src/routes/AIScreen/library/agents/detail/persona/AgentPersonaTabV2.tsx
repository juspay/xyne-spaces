import { useCallback, type ReactElement } from 'react';
import { PROSE_BOX_HEIGHT, ProseBox } from '../../../shared/primitives/ProseBox';
import { AgentPromptVersions } from './AgentPromptVersions';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentDraft } from '../useAgentDraft';
import {
  DetailCard,
  DetailEmpty,
  DetailProse,
  DetailSection,
} from '../../../shared/primitives/DetailPrimitives';
import {
  ClickToEdit,
  DESCRIPTION_EDITOR,
  PROMPT_EDITOR,
  fitToContent,
  useCaretHandoff,
  type CaretHint,
} from '../../../shared/primitives/ClickToEdit';

export function AgentPersonaTabV2({
  agent,
  canEdit,
  canManageCredentials,
  draft,
}: {
  agent: Agent;
  canEdit: boolean;
  canManageCredentials: boolean;
  draft: AgentDraft;
}): ReactElement {
  const caret = useCaretHandoff();

  const attachDescription = useCallback(
    (el: HTMLTextAreaElement | null): void => {
      if (!el) return;
      fitToContent(el);
      caret.claim('description', el);
    },
    [caret],
  );

  const attachPrompt = useCallback(
    (el: HTMLTextAreaElement | null): void => {
      if (!el) return;
      caret.claim('systemPrompt', el);
    },
    [caret],
  );

  const startWithCaret =
    (field: string) =>
    (hint: CaretHint | null): void => {
      caret.arm(field, hint);
      draft.start();
    };

  const editing = canEdit && draft.editing;

  return (
    <div className='flex w-full flex-col gap-8'>
      <div className='flex w-full flex-col gap-8'>
        <DetailSection label='Description' info='What this agent is for'>
          {editing ? (
            <textarea
              value={draft.description}
              onChange={event => {
                draft.setDescription(event.target.value);
                fitToContent(event.target);
              }}
              placeholder='Add a description so people and agents understand when to use it.'
              aria-label='Agent description'
              rows={1}
              ref={attachDescription}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit description'
              className={DESCRIPTION_EDITOR}
            />
          ) : (
            <ClickToEdit
              enabled={canEdit}
              label='Edit description'
              trackName='Agent detail v2: edit description'
              onEdit={startWithCaret('description')}
            >
              <DetailCard>
                {draft.description ? (
                  <DetailProse>{draft.description}</DetailProse>
                ) : (
                  <DetailEmpty>No description added</DetailEmpty>
                )}
              </DetailCard>
            </ClickToEdit>
          )}
        </DetailSection>

        <DetailSection label='System Prompt' info='The instructions this agent runs with'>
          {editing ? (
            <textarea
              value={draft.systemPrompt}
              onChange={event => draft.setSystemPrompt(event.target.value)}
              placeholder='Describe how this agent should behave.'
              aria-label='Agent system prompt'
              ref={attachPrompt}
              style={{ height: PROSE_BOX_HEIGHT }}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: edit system prompt'
              className={PROMPT_EDITOR}
            />
          ) : (
            <ClickToEdit
              enabled={canEdit}
              label='Edit system prompt'
              trackName='Agent detail v2: edit system prompt'
              onEdit={startWithCaret('systemPrompt')}
            >
              {draft.systemPrompt ? (
                <ProseBox>{draft.systemPrompt}</ProseBox>
              ) : (
                <DetailCard>
                  <DetailEmpty>No system prompt set</DetailEmpty>
                </DetailCard>
              )}
            </ClickToEdit>
          )}
        </DetailSection>
      </div>

      {canManageCredentials && (
        <AgentPromptVersions
          agentSlug={agent.slug}
          canRestore={canEdit}
          onRestored={restored => draft.setSystemPrompt(restored)}
        />
      )}

      <ModelCard agent={agent} canEdit={canEdit} />

      <CredentialsCard slug={agent.slug} canRead={canEdit} canManage={canManageCredentials} />
    </div>
  );
}
