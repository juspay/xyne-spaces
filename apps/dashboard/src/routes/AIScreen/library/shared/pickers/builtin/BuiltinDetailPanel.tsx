import { type ReactElement } from 'react';
import { Grid01 } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Pill } from '../../primitives/Pill';
import { SectionHeading, Separator } from '../../primitives/Section';
import { ToolRow } from '../../primitives/ToolRow';
import {
  disableEntry,
  enableEntry,
  isEntryEnabled,
  isToolSelected,
  selectedTools,
  setToolsSelected,
  type BuiltinCatalogEntry,
  type BuiltinSelection,
} from './builtinCatalog';

const RISK_LABEL = { read: 'Read', write: 'Write', destructive: 'Destructive' } as const;
const RISK_TONE = { read: 'success', write: 'warning', destructive: 'danger' } as const;

interface BuiltinDetailPanelProps {
  entry: BuiltinCatalogEntry;
  selection: BuiltinSelection;
  onSelectionChange: (next: BuiltinSelection) => void;
}

export function BuiltinDetailPanel({
  entry,
  selection,
  onSelectionChange,
}: BuiltinDetailPanelProps): ReactElement {
  const enabled = isEntryEnabled(selection, entry);
  const chosen = selectedTools(selection, entry);
  const allChosen = chosen.length === entry.tools.length;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[22px] pb-9 pt-2'>
      <div className='flex w-full items-start gap-12'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm'>
            <Grid01 className='size-5' aria-hidden />
          </span>
          <div className='flex min-w-0 flex-col gap-2.5 py-px'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
                {entry.label}
              </span>
              <Pill tone={RISK_TONE[entry.risk]} size='sm'>
                {RISK_LABEL[entry.risk]}
              </Pill>
            </span>
            <span className='truncate text-xs font-semibold leading-4 tracking-[-0.24px] text-muted-foreground'>
              {entry.tools.length} tools available
            </span>
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onSelectionChange(
              enabled ? disableEntry(selection, entry) : enableEntry(selection, entry),
            )
          }
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle built-in group from detail'
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
          info='Only the tools you select here can be called by this agent'
          action={
            <button
              type='button'
              onClick={() =>
                onSelectionChange(setToolsSelected(selection, entry.tools, !allChosen))
              }
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: toggle all built-in tools'
              className='shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
            >
              {allChosen ? 'Clear all' : `Select all (${chosen.length}/${entry.tools.length})`}
            </button>
          }
        />
        <div className='grid w-full grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-2'>
          {entry.tools.map(tool => {
            const checked = isToolSelected(selection, tool);
            return (
              <ToolRow
                key={tool.slug}
                tool={tool}
                checked={checked}
                onToggle={() => onSelectionChange(setToolsSelected(selection, [tool], !checked))}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
