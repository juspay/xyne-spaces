import type { ReactElement } from 'react';
import {
  DetailCard,
  DetailEmpty,
  DetailProse,
  DetailRow,
  DetailSection,
  DetailValue,
} from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { ProseBox } from '../../../../../routes/AIScreen/library/shared/primitives/ProseBox';
import type { AgentPreviewTabProps } from './AgentPreviewTabs.types';
import { connectedProviderCount, providerLine } from './AgentPreviewTabs.utils';

export function AgentPreviewPersonaTab({ agent }: AgentPreviewTabProps): ReactElement {
  const hasProviders = (agent.providers?.length ?? 0) > 0;

  return (
    <div className='flex flex-col gap-6'>
      <DetailSection label='Description' info='What this agent is for'>
        <DetailCard>
          {agent.description ? (
            <DetailProse>{agent.description}</DetailProse>
          ) : (
            <DetailEmpty>No description added</DetailEmpty>
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection label='Model' info='Which provider and model this agent runs on'>
        <DetailCard>
          <DetailRow title='Model' hint='The model it answers with'>
            <DetailValue>{agent.modelId || 'Platform default'}</DetailValue>
          </DetailRow>
          <DetailRow
            title='Providers'
            hint='Tried in order until one is available'
            last={!hasProviders}
          >
            <DetailValue>{providerLine(agent)}</DetailValue>
          </DetailRow>
          {hasProviders && (
            <DetailRow title='Credentials' hint='Keys saved for this agent' last>
              <DetailValue>{connectedProviderCount(agent)}</DetailValue>
            </DetailRow>
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection label='System Prompt' info='The instructions this agent runs with'>
        {agent.systemPrompt ? (
          <ProseBox>{agent.systemPrompt}</ProseBox>
        ) : (
          <DetailCard>
            <DetailEmpty>No system prompt set</DetailEmpty>
          </DetailCard>
        )}
      </DetailSection>
    </div>
  );
}
