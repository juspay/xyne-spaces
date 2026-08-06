import { type ReactElement } from 'react';
import { ProseBox } from '../create-v2/shared/ProseBox';
import { CredentialsCard } from './credentials/CredentialsCard';
import { ModelCard } from './model/ModelCard';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { DetailCard, DetailEmpty, DetailProse, DetailSection } from './DetailPrimitives';

export function AgentPersonaTabV2({
  agent,
  canEdit,
  canManageCredentials,
}: {
  agent: Agent;
  canEdit: boolean;
  canManageCredentials: boolean;
}): ReactElement {
  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection label='Description' info='What this agent is for'>
        <DetailCard>
          {agent.description ? (
            <DetailProse>{agent.description}</DetailProse>
          ) : (
            <DetailEmpty>No description added</DetailEmpty>
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

      <ModelCard agent={agent} canEdit={canEdit} />

      <CredentialsCard slug={agent.slug} canRead={canEdit} canManage={canManageCredentials} />
    </div>
  );
}
