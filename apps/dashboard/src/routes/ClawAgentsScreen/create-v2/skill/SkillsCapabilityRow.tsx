import { useMemo, useState, type ReactElement } from 'react';
import { InformationCircle, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { BrowseSkillsDialog } from './BrowseSkillsDialog';
import { SkillChip } from './SkillChip';
import { disableSkill, isSkillSelected } from './skillCatalog';
import { useSkillCatalog } from './useSkillCatalog';

const CAPTION = 'Add reusable instructions for specialized workflows.';

interface SkillsCapabilityRowProps {
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
}

export function SkillsCapabilityRow({
  selectedIds,
  onChange,
}: SkillsCapabilityRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const { entries, loading, isError, refetch } = useSkillCatalog();

  const selectedEntries = useMemo(
    () => entries.filter(entry => isSkillSelected(selectedIds, entry)),
    [entries, selectedIds],
  );

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-semibold leading-[1.2] tracking-[-0.1px] text-foreground'>
              Skills
            </span>
            <Tooltip side='top' content={CAPTION}>
              <span className='inline-flex'>
                <InformationCircle className='size-4 text-muted-foreground' aria-hidden />
              </span>
            </Tooltip>
          </div>
          {selectedEntries.length > 0 && (
            <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
              {selectedEntries.length} added
            </span>
          )}
        </div>

        <button
          type='button'
          onClick={() => setBrowseOpen(true)}
          aria-label='Browse skills'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: browse skills'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{CAPTION}</p>

      {selectedEntries.length > 0 && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {selectedEntries.map(entry => (
            <SkillChip
              key={entry.id}
              label={entry.label}
              scope={entry.scope}
              selected
              onToggle={() => onChange(disableSkill(selectedIds, entry))}
            />
          ))}
        </div>
      )}

      <BrowseSkillsDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        catalog={entries}
        loading={loading}
        isError={isError}
        onRetry={refetch}
        selectedIds={selectedIds}
        onChange={onChange}
      />
    </div>
  );
}
