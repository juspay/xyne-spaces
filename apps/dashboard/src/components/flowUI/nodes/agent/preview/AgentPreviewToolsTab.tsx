import type { ReactElement } from 'react';
import { DetailSection } from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { DetailListCard } from '../../../../../routes/AIScreen/library/shared/primitives/DetailListCard';
import type { AgentPreviewToolsProps } from './AgentPreviewTabs.types';
import { TOOL_SECTIONS, toolItemsForGroup } from './AgentPreviewTabs.utils';
import { AgentPreviewToolsEditor } from './AgentPreviewToolsEditor';

export function AgentPreviewToolsTab({ agent, editor }: AgentPreviewToolsProps): ReactElement {
  if (editor?.editable) {
    return <AgentPreviewToolsEditor agent={agent} editor={editor} />;
  }

  const capabilities = agent.capabilities ?? [];

  return (
    <div className='flex flex-col gap-6'>
      {TOOL_SECTIONS.map(section => (
        <DetailSection key={section.group} label={section.label} info={section.info}>
          <DetailListCard
            items={toolItemsForGroup(capabilities, section.group)}
            loading={false}
            emptyLabel={section.empty}
            canEdit={false}
            removeLabel={item => `Remove ${item.name}`}
            onRemove={() => undefined}
          />
        </DetailSection>
      ))}
    </div>
  );
}
