import { useState, type ReactElement } from 'react';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import { Pill } from '../../../shared/primitives/Pill';
import {
  DetailCard,
  DetailEmpty,
  DetailLockedNote,
  DetailProse,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import type { SkillDetailActions } from '../useSkillDetailActions';

const LOCK_NOTE = 'Only the person who created this skill, or an admin, can change it.';

export function SkillOverviewTabV2({
  skill,
  actions,
}: {
  skill: Skill;
  actions: SkillDetailActions;
}): ReactElement {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { canEdit } = actions;

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Description'
        info='What this skill is for, shown wherever it can be attached'
        {...(canEdit ? {} : { trailing: <ReadOnlyBadge />, trailingAlign: 'end' as const })}
      >
        <DetailCard>
          {!canEdit && <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>}
          {skill.description ? (
            <DetailProse>{skill.description}</DetailProse>
          ) : (
            <DetailEmpty>No description added</DetailEmpty>
          )}
        </DetailCard>
      </DetailSection>

      {canEdit && (
        <DetailSection label='Danger Zone' info='Irreversible actions on this skill'>
          <DetailCard>
            <div className='flex w-full items-center gap-3 p-4'>
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <span className='flex min-w-0 items-center gap-1.5'>
                  <span className='truncate text-sm font-medium leading-[22px] text-foreground'>
                    Delete this skill
                  </span>
                  <Pill tone='neutral'>{skill.scope === 'global' ? 'Global' : 'Personal'}</Pill>
                </span>
                <span className='truncate text-sm leading-5 text-foreground/60'>
                  Once you delete a skill, there is no going back. Please be certain.
                </span>
              </div>
              <button
                type='button'
                onClick={() => setDeleteOpen(true)}
                disabled={actions.busy.deleting}
                data-track-category='Claw Agents'
                data-track-name='Skill detail v2: delete skill'
                className='flex h-7 shrink-0 items-center rounded-md bg-destructive/15 px-2 text-sm leading-5 text-destructive transition-colors hover:bg-destructive/25 disabled:pointer-events-none disabled:opacity-50'
              >
                Delete this skill
              </button>
            </div>
          </DetailCard>
        </DetailSection>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='Delete this skill?'
        description={`${skill.label || skill.name} will be removed from every agent and subagent using it. This can't be undone.`}
        confirmLabel='Delete'
        danger
        loading={actions.busy.deleting}
        onConfirm={() => void actions.remove()}
      />
    </div>
  );
}
