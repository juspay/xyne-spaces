import { useMemo, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { Pill } from '../../../shared/primitives/Pill';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import {
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import { BrowseSkillsDialog } from '../../../shared/pickers/skill/BrowseSkillsDialog';
import { useSkillCatalog } from '../../../shared/pickers/skill/useSkillCatalog';
import { useSaveSubagent } from './subagentUpdate';

const LOCK_NOTE =
  'Only the person who created this subagent, an editor, or an admin can change it.';
const BUILT_IN_NOTE =
  'This is a built-in subagent. It ships with the platform, so its knowledge can’t be changed.';

const SOURCE_LABELS: Record<string, string> = {
  seeded: 'Built-in',
  'user-created': 'Custom',
  uploaded: 'Uploaded',
};

function ManageButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name='Subagent detail v2: manage skills'
      className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
    >
      Manage
    </button>
  );
}

export function SubagentKnowledgeTabV2({
  subagent,
  canEdit,
  isBuiltIn,
}: {
  subagent: SubagentDef;
  canEdit: boolean;
  isBuiltIn: boolean;
}): ReactElement {
  const skills = useSkillCatalog();
  const { save, saving } = useSaveSubagent(subagent);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);

  const attachedIds = useMemo(() => subagent.skills.map(skill => skill.id), [subagent.skills]);

  const items = useMemo<DetailListItem[]>(() => {
    const byId = new Map(skills.entries.map(entry => [entry.id, entry]));
    return subagent.skills.map(skill => {
      const entry = byId.get(skill.id);
      return {
        key: skill.id,
        name: `/${skill.slug}`,
        description: entry?.description ?? '',
        badge: (
          <Pill tone='neutral'>
            {SOURCE_LABELS[entry?.source ?? ''] ?? entry?.scope ?? 'Skill'}
          </Pill>
        ),
      };
    });
  }, [subagent.skills, skills.entries]);

  const note = canEdit ? null : (
    <DetailLockedNote>{isBuiltIn ? BUILT_IN_NOTE : LOCK_NOTE}</DetailLockedNote>
  );

  const closeBrowse = (): void => {
    const next = draftIds;
    setBrowseOpen(false);
    setDraftIds(null);
    if (!next) return;
    const unchanged =
      next.length === attachedIds.length && next.every(id => attachedIds.includes(id));
    if (!unchanged) void save({ skillIds: next }, 'Skills updated');
  };

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Skills'
        info='Playbooks this subagent can consult while it runs'
        trailing={
          canEdit ? (
            <ManageButton
              label='Manage skills'
              onClick={() => {
                setDraftIds(attachedIds);
                setBrowseOpen(true);
              }}
            />
          ) : (
            <ReadOnlyBadge />
          )
        }
        trailingAlign='end'
      >
        <DetailListCard
          items={items}
          loading={skills.loading}
          emptyLabel='No skills attached yet.'
          canEdit={canEdit && !saving}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item =>
            void save(
              { skillIds: attachedIds.filter(id => id !== item.key) },
              `${item.name} removed`,
            )
          }
        />
      </DetailSection>

      {saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      <BrowseSkillsDialog
        open={browseOpen}
        onOpenChange={open => {
          if (!open) closeBrowse();
        }}
        catalog={skills.entries}
        loading={skills.loading}
        isError={skills.isError}
        onRetry={skills.refetch}
        selectedIds={draftIds ?? attachedIds}
        onChange={setDraftIds}
      />
    </div>
  );
}
