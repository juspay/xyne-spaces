import type { ReactElement } from 'react';
import {
  DetailCard,
  DetailRow,
  DetailSection,
  DetailValue,
} from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { PreviewReadOnlyList } from './PreviewReadOnlyList';
import type { AgentPreviewTabProps } from './AgentPreviewTabs.types';
import { appliesToLabel, knowledgeItems, skillItems } from './AgentPreviewTabs.utils';

export function AgentPreviewKnowledgeTab({ agent }: AgentPreviewTabProps): ReactElement {
  const memoryEnabled = agent.memory?.enabled ?? false;

  return (
    <div className='flex flex-col gap-6'>
      <DetailSection
        label='Skills'
        info='Reusable instruction packs this agent can run as a slash command'
      >
        <PreviewReadOnlyList items={skillItems(agent)} emptyLabel='No skills attached yet.' />
      </DetailSection>

      <DetailSection
        label='Documents'
        info='Collections and files this agent can look things up in'
      >
        <DetailCard>
          <DetailRow title='Applies To' hint='Whose access decides what this agent can read' last>
            <DetailValue>{appliesToLabel(agent)}</DetailValue>
          </DetailRow>
        </DetailCard>
        <PreviewReadOnlyList
          items={knowledgeItems(agent)}
          emptyLabel='No collections attached yet.'
        />
      </DetailSection>

      <DetailSection label='Memory' info='What this agent remembers between conversations'>
        <DetailCard>
          <DetailRow title='Memory enabled' last={!memoryEnabled}>
            <DetailValue>{memoryEnabled ? 'On' : 'Off'}</DetailValue>
          </DetailRow>
          {memoryEnabled && (
            <DetailRow title='Approval' hint='Whether new memories need a review' last>
              <DetailValue>
                {agent.memory?.requiresApproval ? 'Required' : 'Not required'}
              </DetailValue>
            </DetailRow>
          )}
        </DetailCard>
      </DetailSection>
    </div>
  );
}
