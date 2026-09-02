import { useMemo, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { searchByNameThenDescription } from '../../../shared/librarySearch';
import {
  BROWSE_CARD,
  BROWSE_CARD_IDLE,
  BROWSE_CARD_SELECTED,
} from '../../../shared/primitives/browseCard';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import {
  BrowseDialog,
  handleBrowseDialogOpenChange,
  type FilterOption,
} from '../../../shared/primitives/BrowseDialog';
import { Pill } from '../../../shared/primitives/Pill';
import { humanizeToolName } from '../../../shared/primitives/ToolRow';
import { BuiltinChip } from '../../../shared/pickers/builtin/BuiltinChip';
import { SubagentToolGroupPanel } from './SubagentToolGroupPanel';
import {
  humanizeSource,
  isGroupEnabled,
  selectedInGroup,
  setToolsSelected,
  type SubagentSelection,
  type SubagentToolGroup,
  type SubagentToolSectionData,
} from './subagentToolCatalog';

function groupSearchFields(group: SubagentToolGroup) {
  return {
    name: humanizeSource(group.source),
    extras: group.tools.map(tool => humanizeToolName(tool.name)),
  };
}

const GroupCard = ({
  group,
  enabled,
  selectedCount,
  onOpen,
  onToggle,
}: {
  group: SubagentToolGroup;
  enabled: boolean;
  selectedCount: number;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => (
  <div className='group relative min-w-0'>
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create subagent v2: open tool group detail'
      className={cn(BROWSE_CARD, enabled ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
    >
      <span className='flex w-full items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium leading-5 text-foreground'>
            {humanizeSource(group.source)}
          </span>
          {enabled && (
            <Pill tone='success' size='sm'>
              Enabled
            </Pill>
          )}
        </span>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground'>
          <ChevronRight className='size-4' aria-hidden />
        </span>
      </span>
      <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        {enabled
          ? `${selectedCount} of ${group.tools.length} tools selected`
          : `${group.tools.length} tools available`}
      </span>
    </button>

    <button
      type='button'
      onClick={onToggle}
      aria-label={`${enabled ? 'Remove' : 'Add'} ${humanizeSource(group.source)}`}
      title={
        enabled
          ? `Remove ${humanizeSource(group.source)}`
          : `Add all ${humanizeSource(group.source)} tools`
      }
      data-track-category='Claw Agents'
      data-track-name='Create subagent v2: quick toggle tool group'
      className='absolute right-9 top-2.5 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
    >
      {enabled ? (
        <MultipleCrossCancelDefault className='size-4' aria-hidden />
      ) : (
        <PlusDefault className='size-4' aria-hidden />
      )}
    </button>
  </div>
);

interface BrowseSubagentToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SubagentToolSectionData;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
  loading: boolean;
}

export function BrowseSubagentToolsDialog({
  open,
  onOpenChange,
  section,
  selection,
  onSelectionChange,
  loading,
}: BrowseSubagentToolsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);

  const openGroup = section.groups.find(group => group.source === openSource) ?? null;

  const filterOptions = useMemo<FilterOption[]>(
    () => [
      { id: null, label: 'All sources' },
      ...section.groups.map(group => ({ id: group.source, label: humanizeSource(group.source) })),
    ],
    [section.groups],
  );

  const q = query.trim();
  const visible = useMemo(
    () =>
      searchByNameThenDescription(section.groups, q, groupSearchFields).filter(
        group => source === null || group.source === source,
      ),
    [section.groups, q, source],
  );

  const selectedGroups = useMemo(
    () => section.groups.filter(group => isGroupEnabled(selection, section.kind, group)),
    [section.groups, section.kind, selection],
  );

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next =>
        handleBrowseDialogOpenChange(next, onOpenChange, () => {
          setQuery('');
          setSource(null);
          setOpenSource(null);
        })
      }
      title={`Browse ${section.title}`}
      description={section.caption}
      testId={`browse-subagent-${section.kind}-tools-dialog`}
      {...(openGroup && {
        detail: {
          label: humanizeSource(openGroup.source),
          onBack: () => setOpenSource(null),
          content: (
            <SubagentToolGroupPanel
              group={openGroup}
              kind={section.kind}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          ),
        },
      })}
      query={query}
      onQueryChange={setQuery}
      filterOptions={filterOptions}
      activeFilter={source}
      onFilterChange={setSource}
      chips={
        selectedGroups.length > 0 ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {selectedGroups.map(group => (
              <BuiltinChip
                key={`selected-${group.source}`}
                label={humanizeSource(group.source)}
                selected
                onToggle={() =>
                  onSelectionChange(setToolsSelected(selection, section.kind, group.tools, false))
                }
              />
            ))}
          </div>
        ) : null
      }
      loading={loading}
      isError={false}
      onRetry={() => undefined}
      emptyMessage={
        visible.length === 0
          ? q
            ? `No tools match “${query.trim()}”.`
            : 'No tools available yet.'
          : null
      }
    >
      <div className='grid w-full grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2'>
        {visible.map(group => (
          <GroupCard
            key={group.source}
            group={group}
            enabled={isGroupEnabled(selection, section.kind, group)}
            selectedCount={selectedInGroup(selection, section.kind, group).length}
            onOpen={() => setOpenSource(group.source)}
            onToggle={() =>
              onSelectionChange(
                setToolsSelected(
                  selection,
                  section.kind,
                  group.tools,
                  !isGroupEnabled(selection, section.kind, group),
                ),
              )
            }
          />
        ))}
      </div>
    </BrowseDialog>
  );
}
