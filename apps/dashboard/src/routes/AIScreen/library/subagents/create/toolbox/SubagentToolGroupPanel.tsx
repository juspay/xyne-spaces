import { type ReactElement } from 'react';
import { CheckTickSquare, Grid01, Square } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { SectionHeading, Separator } from '../../../shared/primitives/Section';
import { humanizeToolName } from '../../../shared/primitives/ToolRow';
import {
  humanizeSource,
  isGroupEnabled,
  isToolSelected,
  selectedInGroup,
  setToolsSelected,
  type SubagentSelection,
  type SubagentToolGroup,
  type SubagentToolKind,
} from './subagentToolCatalog';

interface SubagentToolGroupPanelProps {
  group: SubagentToolGroup;
  kind: SubagentToolKind;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
}

export function SubagentToolGroupPanel({
  group,
  kind,
  selection,
  onSelectionChange,
}: SubagentToolGroupPanelProps): ReactElement {
  const enabled = isGroupEnabled(selection, kind, group);
  const chosen = selectedInGroup(selection, kind, group);
  const allChosen = chosen.length === group.tools.length;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-start gap-12'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm'>
            <Grid01 className='size-5' aria-hidden />
          </span>
          <div className='flex min-w-0 flex-col gap-2.5 py-px'>
            <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
              {humanizeSource(group.source)}
            </span>
            <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
              {group.tools.length} tools available
            </span>
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onSelectionChange(setToolsSelected(selection, kind, group.tools, !enabled))
          }
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: toggle tool group from detail'
          className={cn(
            'flex h-7 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium leading-[1.2] transition-colors',
            enabled
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <Separator />

      <section className='flex flex-col gap-4'>
        <SectionHeading
          label='Tools'
          info='Only the tools you select here can be called by this subagent'
          action={
            <button
              type='button'
              onClick={() =>
                onSelectionChange(setToolsSelected(selection, kind, group.tools, !allChosen))
              }
              data-track-category='Claw Agents'
              data-track-name='Create subagent v2: toggle all tools in group'
              className='shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
            >
              {allChosen ? 'Clear all' : `Select all (${chosen.length}/${group.tools.length})`}
            </button>
          }
        />
        <div className='grid w-full grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-2'>
          {group.tools.map(tool => {
            const checked = isToolSelected(selection, kind, tool);
            return (
              <button
                key={tool.key}
                type='button'
                role='checkbox'
                aria-checked={checked}
                onClick={() =>
                  onSelectionChange(setToolsSelected(selection, kind, [tool], !checked))
                }
                data-track-category='Claw Agents'
                data-track-name='Create subagent v2: toggle tool'
                className='flex w-full items-center gap-2 text-left'
              >
                {checked ? (
                  <CheckTickSquare
                    variant='Solid'
                    className='size-5 shrink-0 text-primary'
                    aria-hidden
                  />
                ) : (
                  <Square className='size-5 shrink-0 text-border' aria-hidden />
                )}
                <span className='min-w-0 truncate text-sm font-normal leading-[1.2] text-foreground'>
                  {humanizeToolName(tool.name)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
