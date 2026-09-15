import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { searchByNameThenDescription } from '../../librarySearch';
import { BROWSE_CARD, BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import {
  BrowseDialog,
  handleBrowseDialogOpenChange,
  type FilterOption,
} from '../../primitives/BrowseDialog';
import { Pill } from '../../primitives/Pill';
import { SectionHeading, Separator } from '../../primitives/Section';
import { SkillChip } from './SkillChip';
import { SkillDetailPanel } from './SkillDetailPanel';
import { disableSkill, isSkillSelected, toggleSkill, type SkillCatalogEntry } from './skillCatalog';

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: null, label: 'All' },
  { id: 'personal', label: 'My skills' },
  { id: 'global', label: 'Global skills' },
];

const SECTIONS = [
  { key: 'personal', label: 'My skills' },
  { key: 'global', label: 'Global skills' },
] as const;

const SkillCard = ({
  entry,
  selected,
  onOpen,
  onToggle,
}: {
  entry: SkillCatalogEntry;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => (
  <div className='group relative min-w-0'>
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: open skill detail'
      className={cn(BROWSE_CARD, selected ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
    >
      <span className='flex w-full items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium leading-5 text-foreground'>
            {entry.label}
          </span>
          {selected && (
            <Pill tone='success' size='sm'>
              Enabled
            </Pill>
          )}
          {!entry.enabled && (
            <Pill tone='neutral' size='sm'>
              Disabled
            </Pill>
          )}
        </span>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground'>
          <ChevronRight className='size-4' aria-hidden />
        </span>
      </span>
      <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        {entry.description || entry.slug}
      </span>
    </button>

    <button
      type='button'
      onClick={onToggle}
      aria-label={`${selected ? 'Remove' : 'Add'} ${entry.label}`}
      title={`${selected ? 'Remove' : 'Add'} ${entry.label}`}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: quick toggle skill'
      className='absolute right-11 top-4 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
    >
      {selected ? (
        <MultipleCrossCancelDefault className='size-4' aria-hidden />
      ) : (
        <PlusDefault className='size-4' aria-hidden />
      )}
    </button>
  </div>
);

interface BrowseSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly SkillCatalogEntry[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
}

export function BrowseSkillsDialog({
  open,
  onOpenChange,
  catalog,
  loading,
  isError,
  onRetry,
  selectedIds,
  onChange,
}: BrowseSkillsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const openEntry = catalog.find(entry => entry.id === openId) ?? null;

  const q = query.trim();
  const visible = useMemo(
    () =>
      searchByNameThenDescription(catalog, q, entry => ({
        name: entry.label,
        description: entry.description,
        ...(entry.slug && entry.slug !== entry.label ? { aliases: [entry.slug] as const } : {}),
      })).filter(entry => scope === null || entry.scope === scope),
    [catalog, q, scope],
  );

  const sections = useMemo(
    () =>
      SECTIONS.map(section => ({
        ...section,
        entries: visible.filter(entry => entry.scope === section.key),
      })).filter(section => section.entries.length > 0),
    [visible],
  );

  const selectedEntries = useMemo(
    () => catalog.filter(entry => isSkillSelected(selectedIds, entry)),
    [catalog, selectedIds],
  );

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next =>
        handleBrowseDialogOpenChange(next, onOpenChange, () => {
          setQuery('');
          setScope(null);
          setOpenId(null);
        })
      }
      title='Browse skills'
      description='Search and select the skills this agent can draw on.'
      testId='browse-skills-dialog'
      {...(openEntry && {
        detail: {
          label: openEntry.label,
          onBack: () => setOpenId(null),
          content: (
            <SkillDetailPanel entry={openEntry} selectedIds={selectedIds} onChange={onChange} />
          ),
        },
      })}
      query={query}
      onQueryChange={setQuery}
      filterOptions={FILTER_OPTIONS}
      activeFilter={scope}
      onFilterChange={setScope}
      chips={
        selectedEntries.length > 0 ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {selectedEntries.map(entry => (
              <SkillChip
                key={entry.id}
                label={entry.label}
                selected
                onToggle={() => onChange(disableSkill(selectedIds, entry))}
              />
            ))}
          </div>
        ) : null
      }
      loading={loading}
      isError={isError}
      onRetry={onRetry}
      emptyMessage={
        sections.length === 0
          ? q
            ? `No skills match “${query.trim()}”.`
            : 'No skills yet. Create one from the Skills page to attach it here.'
          : null
      }
    >
      {sections.map((section, index) => (
        <Fragment key={section.key}>
          {index > 0 && <Separator className='px-2.5' />}
          <section className='flex flex-col gap-2'>
            <SectionHeading label={section.label} className='px-2.5' />
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {section.entries.map(entry => (
                <SkillCard
                  key={entry.id}
                  entry={entry}
                  selected={isSkillSelected(selectedIds, entry)}
                  onOpen={() => setOpenId(entry.id)}
                  onToggle={() => onChange(toggleSkill(selectedIds, entry))}
                />
              ))}
            </div>
          </section>
        </Fragment>
      ))}
    </BrowseDialog>
  );
}
