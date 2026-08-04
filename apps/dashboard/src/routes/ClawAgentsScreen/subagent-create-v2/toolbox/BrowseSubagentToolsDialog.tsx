import { useMemo, useState, type ReactElement } from 'react';
import { BrowseDialog, type FilterOption } from '../../create-v2/shared/BrowseDialog';
import { SectionHeading } from '../../create-v2/shared/Section';
import { humanizeToolName } from '../../create-v2/shared/ToolRow';
import { CheckTickSquare, Square } from '@xyne/icons';
import {
  isToolSelected,
  selectedIn,
  setToolsSelected,
  type SubagentSelection,
  type SubagentToolEntry,
  type SubagentToolSectionData,
} from './subagentToolCatalog';

function humanizeSource(source: string): string {
  const bare = source.replace(/^custom:/, '').replace(/^mcp:/, '');
  return bare.replace(/[-_]/g, ' ').replace(/^[a-z]/, char => char.toUpperCase());
}

const ToolRow = ({
  tool,
  checked,
  onToggle,
}: {
  tool: SubagentToolEntry;
  checked: boolean;
  onToggle: () => void;
}): ReactElement => (
  <button
    type='button'
    role='checkbox'
    aria-checked={checked}
    onClick={onToggle}
    data-track-category='Claw Agents'
    data-track-name='Create subagent v2: toggle tool'
    className='flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-muted/50'
  >
    {checked ? (
      <CheckTickSquare variant='Solid' className='size-5 shrink-0 text-primary' aria-hidden />
    ) : (
      <Square className='size-5 shrink-0 text-border' aria-hidden />
    )}
    <span className='min-w-0 truncate text-sm font-normal leading-[1.2] text-foreground'>
      {humanizeToolName(tool.name)}
    </span>
  </button>
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

  const filterOptions = useMemo<FilterOption[]>(
    () => [
      { id: null, label: 'All sources' },
      ...section.groups.map(entry => ({ id: entry.source, label: humanizeSource(entry.source) })),
    ],
    [section.groups],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      section.groups
        .filter(entry => source === null || entry.source === source)
        .map(entry => ({
          ...entry,
          tools: entry.tools.filter(tool => humanizeToolName(tool.name).toLowerCase().includes(q)),
        }))
        .filter(entry => entry.tools.length > 0),
    [section.groups, q, source],
  );

  const chosen = selectedIn(selection, section);

  return (
    <BrowseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Browse ${section.title}`}
      description={section.caption}
      testId={`browse-subagent-${section.kind}-tools-dialog`}
      query={query}
      onQueryChange={setQuery}
      filterOptions={filterOptions}
      activeFilter={source}
      onFilterChange={setSource}
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
      <div className='flex w-full flex-col gap-6'>
        {visible.map(entry => {
          const all = entry.tools.every(tool => isToolSelected(selection, section.kind, tool));
          const count = entry.tools.filter(tool =>
            isToolSelected(selection, section.kind, tool),
          ).length;
          return (
            <section key={entry.source} className='flex w-full flex-col gap-2'>
              <SectionHeading
                label={humanizeSource(entry.source)}
                className='px-2'
                action={
                  <button
                    type='button'
                    onClick={() =>
                      onSelectionChange(
                        setToolsSelected(selection, section.kind, entry.tools, !all),
                      )
                    }
                    data-track-category='Claw Agents'
                    data-track-name='Create subagent v2: toggle all tools in source'
                    className='shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
                  >
                    {all ? 'Clear all' : `Select all (${count}/${entry.tools.length})`}
                  </button>
                }
              />
              <div className='grid w-full grid-cols-1 gap-x-12 gap-y-1 sm:grid-cols-2'>
                {entry.tools.map(tool => {
                  const checked = isToolSelected(selection, section.kind, tool);
                  return (
                    <ToolRow
                      key={tool.key}
                      tool={tool}
                      checked={checked}
                      onToggle={() =>
                        onSelectionChange(
                          setToolsSelected(selection, section.kind, [tool], !checked),
                        )
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {chosen.length > 0 && <span className='sr-only'>{chosen.length} selected</span>}
    </BrowseDialog>
  );
}
