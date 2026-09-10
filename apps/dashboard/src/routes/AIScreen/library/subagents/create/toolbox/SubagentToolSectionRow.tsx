import { useState, type ReactElement } from 'react';
import { InformationCircle, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { BuiltinChip } from '../../../shared/pickers/builtin/BuiltinChip';
import { BrowseSubagentToolsDialog } from './BrowseSubagentToolsDialog';
import {
  humanizeSource,
  isGroupEnabled,
  selectedIn,
  setToolsSelected,
  type SubagentSelection,
  type SubagentToolSectionData,
} from './subagentToolCatalog';

interface SubagentToolSectionRowProps {
  section: SubagentToolSectionData;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
  loading: boolean;
}

export function SubagentToolSectionRow({
  section,
  selection,
  onSelectionChange,
  loading,
}: SubagentToolSectionRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const chosen = selectedIn(selection, section);
  const selectedGroups = section.groups.filter(group =>
    isGroupEnabled(selection, section.kind, group),
  );

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
              {section.title}
            </span>
            <Tooltip side='top' content={section.caption}>
              <span className='inline-flex'>
                <InformationCircle className='size-4 text-muted-foreground' aria-hidden />
              </span>
            </Tooltip>
          </div>
          {chosen.length > 0 && (
            <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
              {chosen.length} of {section.total} selected
            </span>
          )}
        </div>

        <button
          type='button'
          onClick={() => setBrowseOpen(true)}
          aria-label={`Browse ${section.title}`}
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: browse tools'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{section.caption}</p>

      {selectedGroups.length > 0 && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {selectedGroups.map(group => (
            <BuiltinChip
              key={group.source}
              label={humanizeSource(group.source)}
              selected
              onToggle={() =>
                onSelectionChange(setToolsSelected(selection, section.kind, group.tools, false))
              }
            />
          ))}
        </div>
      )}

      <BrowseSubagentToolsDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        section={section}
        selection={selection}
        onSelectionChange={onSelectionChange}
        loading={loading}
      />
    </div>
  );
}
