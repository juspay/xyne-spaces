import { type ReactElement } from 'react';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { ProseBox } from '../../../shared/primitives/ProseBox';
import {
  DetailCard,
  DetailEmpty,
  DetailLockedNote,
  DetailProse,
  DetailRow,
  DetailSection,
  DetailValue,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';

const BUILT_IN_NOTE =
  'This is a built-in subagent. It ships with the platform, so its persona can’t be changed.';
const VIEW_ONLY_NOTE =
  'Only the person who created this subagent, an editor, or an admin can change it.';

export function SubagentPersonaTabV2({
  subagent,
  canEdit,
  isBuiltIn,
}: {
  subagent: SubagentDef;
  canEdit: boolean;
  isBuiltIn: boolean;
}): ReactElement {
  const note = canEdit ? null : (
    <DetailLockedNote>{isBuiltIn ? BUILT_IN_NOTE : VIEW_ONLY_NOTE}</DetailLockedNote>
  );
  const badge = canEdit ? {} : { trailing: <ReadOnlyBadge />, trailingAlign: 'end' as const };

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Description'
        info='The one-liner the parent agent reads when deciding who to delegate to'
        {...badge}
      >
        <DetailCard>
          {note}
          {subagent.description ? (
            <DetailProse>{subagent.description}</DetailProse>
          ) : (
            <DetailEmpty>No description added</DetailEmpty>
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection
        label='System Prompt'
        info='The persona and instructions the model receives before it runs'
        {...badge}
      >
        {subagent.systemPrompt ? (
          <ProseBox>{subagent.systemPrompt}</ProseBox>
        ) : (
          <DetailCard>
            <DetailEmpty>No system prompt set</DetailEmpty>
          </DetailCard>
        )}
      </DetailSection>

      <DetailSection label='Identity' info='How this subagent is addressed and reported'>
        <DetailCard>
          <DetailRow title='Handle' hint='The name agents delegate to — fixed once created'>
            <DetailValue>{subagent.name}</DetailValue>
          </DetailRow>
          <DetailRow title='Source' hint='Where this definition came from'>
            <DetailValue>{isBuiltIn ? 'Built-in' : 'Custom'}</DetailValue>
          </DetailRow>
          <DetailRow title='Status' hint='Whether agents can delegate to it right now'>
            <DetailValue>{subagent.enabled ? 'Enabled' : 'Disabled'}</DetailValue>
          </DetailRow>
          <DetailRow
            title='Progress labels'
            hint='Shown one after another while the subagent works'
            last
          >
            <DetailValue>
              {subagent.progressLabels.length > 0
                ? subagent.progressLabels.join(' · ')
                : 'None set'}
            </DetailValue>
          </DetailRow>
        </DetailCard>
      </DetailSection>
    </div>
  );
}
