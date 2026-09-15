import type { ReactElement } from 'react';
import { DetailSection } from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { DetailListCard } from '../../../../../routes/AIScreen/library/shared/primitives/DetailListCard';
import type { AgentPreviewToolsProps } from './AgentPreviewTabs.types';
import { TOOL_SECTIONS, toolItemsForGroup } from './AgentPreviewTabs.utils';

export function AgentPreviewToolsTab({ agent, interactive }: AgentPreviewToolsProps): ReactElement {
  const capabilities = agent.capabilities ?? [];
  const canEdit = Boolean(interactive) && !interactive?.disabled;

  return (
    <div className='flex flex-col gap-6'>
      {TOOL_SECTIONS.map(section => (
        <DetailSection key={section.group} label={section.label} info={section.info}>
          <DetailListCard
            items={toolItemsForGroup(capabilities, section.group)}
            loading={false}
            emptyLabel={section.empty}
            canEdit={canEdit}
            removeLabel={item => `Remove ${item.name}`}
            onRemove={item => interactive?.onToggle(item.key)}
          />
        </DetailSection>
      ))}
    </div>
  );
}
