import { useState, type ReactElement } from 'react';
import { InformationCircle, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { humanizeToolName } from '../../create-v2/shared/ToolRow';
import { BrowseSubagentToolsDialog } from './BrowseSubagentToolsDialog';
import {
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

      {chosen.length > 0 && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {chosen.map(tool => (
            <button
              key={tool.key}
              type='button'
              onClick={() =>
                onSelectionChange(setToolsSelected(selection, section.kind, [tool], false))
              }
              title={`Remove ${tool.name}`}
              aria-label={`Remove ${tool.name}`}
              data-track-category='Claw Agents'
              data-track-name='Create subagent v2: remove tool chip'
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-border bg-muted px-2 transition-colors hover:bg-muted/70',
              )}
            >
              <span className='max-w-[200px] truncate text-sm font-medium leading-5 text-foreground'>
                {humanizeToolName(tool.name)}
              </span>
              <MultipleCrossCancelDefault
                className='size-3 shrink-0 text-muted-foreground'
                aria-hidden
              />
            </button>
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
