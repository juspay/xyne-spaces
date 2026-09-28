import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { PencilEditLine } from '@xyne/icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import {
  DetailCard,
  DetailEmpty,
  DetailProse,
  DetailRow,
  DetailSection,
  DetailValue,
} from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import {
  PROSE_BOX_HEIGHT,
  ProseBox,
} from '../../../../../routes/AIScreen/library/shared/primitives/ProseBox';
import {
  ClickToEdit,
  DESCRIPTION_EDITOR,
  PROMPT_EDITOR,
  fitToContent,
  useCaretHandoff,
  type CaretHint,
} from '../../../../../routes/AIScreen/library/shared/primitives/ClickToEdit';
import { ProviderOrderDialog } from '../../../../../routes/AIScreen/library/agents/detail/persona/model/ProviderOrderDialog';
import { AgentKeysDialog } from '../../../../../routes/AIScreen/library/agents/detail/persona/credentials/AgentKeysDialog';
import { userCredentialScope } from '../../../../../routes/AIScreen/library/agents/detail/persona/credentials/credentialScope';
import { useCredentialHealth } from '../../../../../routes/AIScreen/library/agents/detail/persona/credentials/useCredentialHealth';
import { useFlow } from '../../../FlowContext';
import type { AgentPreviewEditableProps } from './AgentPreviewTabs.types';
import { connectedProviderCount, providerLine } from './AgentPreviewTabs.utils';
import {
  defaultModelLabel,
  needsProviderKey,
  providerDisplayName,
  useDraftModelOptions,
} from './useDraftModelOptions';

const PLATFORM_DEFAULT_VALUE = '__platform_default__';

export function AgentPreviewPersonaTab({ agent, editor }: AgentPreviewEditableProps): ReactElement {
  const { data } = useFlow();
  const [orderOpen, setOrderOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const editable = editor?.editable ?? false;
  const editingIdentity = editor?.editingIdentity ? editor : null;
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
      editor?.startIdentityEdit();
    };

  const posterSlug = typeof data['agentSlug'] === 'string' ? data['agentSlug'] : '';
  const cardUserId = typeof data['userId'] === 'string' ? data['userId'] : '';

  const modelId = editor?.modelId ?? agent.modelId ?? '';
  const providerOrder = editor?.providerOrder ?? agent.providerOrder ?? [];
  const hasProviders = (agent.providers?.length ?? 0) > 0;

  const models = useDraftModelOptions({
    provider: providerOrder[0],
    userId: cardUserId,
    posterSlug,
    enabled: editable,
  });

  const primaryProvider = providerOrder[0];
  const connectScope = useMemo(() => userCredentialScope(cardUserId), [cardUserId]);
  const providerHealth = useCredentialHealth(
    connectScope,
    needsProviderKey(primaryProvider) ? [primaryProvider] : [],
    cardUserId.length > 0,
  );
  const providerStatus = primaryProvider
    ? providerHealth.byProvider.get(primaryProvider)?.status
    : undefined;
  const providerNotReady = providerStatus === 'missing' || providerStatus === 'invalid';

  const fallbackLabel = defaultModelLabel(providerOrder[0]);
  const modelValue = modelId || PLATFORM_DEFAULT_VALUE;
  const modelOptions = [
    { value: PLATFORM_DEFAULT_VALUE, label: fallbackLabel },
    ...models.options,
    ...(modelId && !models.options.some(option => option.value === modelId)
      ? [{ value: modelId, label: modelId }]
      : []),
  ];

  return (
    <div className='flex flex-col gap-6'>
      <DetailSection label='Description' info='What this agent is for'>
        {editingIdentity ? (
          <textarea
            value={editingIdentity.identityDraft.description}
            onChange={event => {
              editingIdentity.setIdentityField('description', event.target.value);
              fitToContent(event.target);
            }}
            aria-label='Agent description'
            placeholder='What this agent is for'
            rows={1}
            ref={attachDescription}
            data-track-category='AGENT_ARTIFACT'
            data-track-name='EDIT_DRAFT_DESCRIPTION'
            className={DESCRIPTION_EDITOR}
          />
        ) : (
          <ClickToEdit
            enabled={editable}
            label='Edit description'
            trackName='EDIT_DRAFT_DESCRIPTION_BOX'
            onEdit={startWithCaret('description')}
          >
            <DetailCard>
              {agent.description ? (
                <DetailProse>{agent.description}</DetailProse>
              ) : (
                <DetailEmpty>No description added</DetailEmpty>
              )}
            </DetailCard>
          </ClickToEdit>
        )}
      </DetailSection>

      <DetailSection label='Model' info='Which provider and model this agent runs on'>
        <DetailCard>
          <DetailRow title='Model' hint='The model it answers with'>
            {editable && modelOptions.length > 1 ? (
              <Select
                value={modelValue}
                onValueChange={next =>
                  editor?.setModelId(next === PLATFORM_DEFAULT_VALUE ? '' : next)
                }
              >
                <SelectTrigger
                  size='sm'
                  aria-label='Model this agent runs on'
                  data-track-category='AGENT_ARTIFACT'
                  data-track-name='SET_DRAFT_MODEL'
                  className='h-9 w-auto min-w-0 max-w-[260px] gap-2 rounded-[10px]'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align='end'>
                  {modelOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <DetailValue>{modelId || fallbackLabel}</DetailValue>
            )}
          </DetailRow>

          <DetailRow
            title='Providers'
            hint='Tried in order until one is available'
            last={!hasProviders}
          >
            <DetailValue>{providerLine({ ...agent, providerOrder })}</DetailValue>
            {editable && (
              <button
                type='button'
                onClick={(): void => setOrderOpen(true)}
                aria-label='Edit provider order'
                data-track-category='AGENT_ARTIFACT'
                data-track-name='EDIT_DRAFT_PROVIDER_ORDER'
                className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <PencilEditLine className='size-4' aria-hidden />
              </button>
            )}
          </DetailRow>
          {hasProviders && (
            <DetailRow title='Credentials' hint='Keys saved for this agent' last>
              <DetailValue>{connectedProviderCount(agent)}</DetailValue>
            </DetailRow>
          )}
        </DetailCard>
        {providerNotReady && primaryProvider && (
          <div className='flex flex-wrap items-center gap-2 px-1'>
            <p className='text-xs leading-4 text-muted-foreground'>
              {providerStatus === 'invalid'
                ? `Your ${providerDisplayName(primaryProvider)} key was rejected, so this agent falls back to the platform default.`
                : `${providerDisplayName(primaryProvider)} isn't connected, so this agent falls back to the platform default.`}
            </p>
            <button
              type='button'
              onClick={(): void => setConnectOpen(true)}
              data-track-category='AGENT_ARTIFACT'
              data-track-name='CONNECT_DRAFT_PROVIDER'
              className='text-xs font-medium leading-4 text-blue-500 underline underline-offset-2 hover:text-blue-600 dark:text-blue-400'
            >
              {providerStatus === 'invalid' ? 'Reconnect' : 'Connect'}{' '}
              {providerDisplayName(primaryProvider)}
            </button>
          </div>
        )}
        {!providerNotReady && editable && models.hint && (
          <p className='px-1 text-xs leading-4 text-muted-foreground'>{models.hint}</p>
        )}
      </DetailSection>

      <DetailSection label='System Prompt' info='The instructions this agent runs with'>
        {editingIdentity ? (
          <textarea
            value={editingIdentity.identityDraft.systemPrompt}
            onChange={event => editingIdentity.setIdentityField('systemPrompt', event.target.value)}
            aria-label='Agent system prompt'
            placeholder='The instructions this agent runs with'
            ref={attachPrompt}
            style={{ height: PROSE_BOX_HEIGHT }}
            data-track-category='AGENT_ARTIFACT'
            data-track-name='EDIT_DRAFT_SYSTEM_PROMPT'
            className={PROMPT_EDITOR}
          />
        ) : (
          <ClickToEdit
            enabled={editable}
            label='Edit system prompt'
            trackName='EDIT_DRAFT_SYSTEM_PROMPT_BOX'
            onEdit={startWithCaret('systemPrompt')}
          >
            {agent.systemPrompt ? (
              <ProseBox>{agent.systemPrompt}</ProseBox>
            ) : (
              <DetailCard>
                <DetailEmpty>No system prompt set</DetailEmpty>
              </DetailCard>
            )}
          </ClickToEdit>
        )}
      </DetailSection>

      {connectOpen && primaryProvider && (
        <AgentKeysDialog
          open
          onOpenChange={(next: boolean): void => setConnectOpen(next)}
          scope={connectScope}
          canManage
          initialProvider={primaryProvider}
        />
      )}

      {editor && (
        <ProviderOrderDialog
          open={orderOpen}
          onOpenChange={setOrderOpen}
          order={providerOrder}
          saving={false}
          onSave={next => {
            editor.setProviderOrder(next);
            setOrderOpen(false);
          }}
        />
      )}
    </div>
  );
}
