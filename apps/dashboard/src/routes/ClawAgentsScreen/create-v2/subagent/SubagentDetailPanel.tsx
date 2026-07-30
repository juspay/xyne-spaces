import { type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import { Pill } from '../shared/Pill';
import { SectionHeading, Separator } from '../shared/Section';
import { SubagentAvatar } from './SubagentAvatar';
import {
  disableSubagent,
  enableSubagent,
  isSubagentSelected,
  type SubagentCatalogEntry,
  type SubagentSelection,
} from './subagentCatalog';

const RISK_LABEL = {
  read: 'Read',
  write: 'Write',
  destructive: 'Destructive',
} as const;

const RISK_TONE = {
  read: 'success',
  write: 'warning',
  destructive: 'danger',
} as const;

const MetaRow = ({ label, children }: { label: string; children: ReactNode }): ReactElement => (
  <div className='flex min-h-7 items-center justify-between gap-3'>
    <span className='text-sm leading-5 text-muted-foreground'>{label}</span>
    <span className='flex min-w-0 items-center gap-1.5 text-sm leading-5 text-foreground'>
      {children}
    </span>
  </div>
);

interface SubagentDetailPanelProps {
  entry: SubagentCatalogEntry;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
}

export function SubagentDetailPanel({
  entry,
  selection,
  onSelectionChange,
}: SubagentDetailPanelProps): ReactElement {
  const selected = isSubagentSelected(selection, entry);
  const { def } = entry;
  const author = def?.createdByName || def?.createdByEmail;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-2 pt-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <SubagentAvatar source={entry.source} size='lg' />
          <div className='flex min-w-0 flex-col gap-2'>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='truncate text-sm font-bold leading-5 tracking-[-0.28px] text-foreground'>
                {entry.name}
              </span>
              <Pill tone={RISK_TONE[entry.risk]}>{RISK_LABEL[entry.risk]}</Pill>
            </span>
            {entry.description && (
              <span className='truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
                {entry.description}
              </span>
            )}
          </div>
        </div>
        <button
          type='button'
          onClick={() =>
            onSelectionChange(
              selected ? disableSubagent(selection, entry) : enableSubagent(selection, entry),
            )
          }
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle subagent from detail'
          className={cn(
            'flex h-7 shrink-0 items-center rounded-lg border px-2 text-sm font-medium leading-5 transition-colors',
            selected
              ? 'border-border bg-card text-foreground hover:bg-muted'
              : 'border-border bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {selected ? 'Disable' : 'Enable'}
        </button>
      </div>

      <Separator />

      <section className='flex flex-col gap-4'>
        <SectionHeading label='Details' info='Where this subagent comes from and how it runs' />
        <div className='flex flex-col gap-2'>
          <MetaRow label='Type'>
            <Pill tone='neutral'>{entry.source === 'builtin' ? 'Built-in' : 'Custom'}</Pill>
          </MetaRow>
          <MetaRow label='Availability'>
            {def && !def.enabled ? (
              <Pill tone='neutral'>Disabled</Pill>
            ) : (
              <Pill tone='success'>Available</Pill>
            )}
          </MetaRow>
          {entry.progressLabel && <MetaRow label='Progress label'>{entry.progressLabel}</MetaRow>}
          {author && <MetaRow label='Created by'>{author}</MetaRow>}
        </div>
      </section>

      <Separator />

      <section className='flex flex-col gap-4'>
        <SectionHeading
          label='Capabilities'
          info='Tools and skills this subagent brings with it — they are fixed by its definition'
        />
        <div className='flex flex-col gap-2'>
          <MetaRow label='Tools'>{entry.toolCount}</MetaRow>
          <MetaRow label='Skills'>{entry.skillCount}</MetaRow>
        </div>
        {def && def.skills.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {def.skills.map(skill => (
              <span
                key={skill.id}
                className='rounded-md border border-border bg-muted px-2 py-1 text-xs leading-4 text-muted-foreground'
              >
                {skill.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <p className='text-xs leading-4 text-muted-foreground'>
        Adding a subagent lets this agent delegate matching work to it. The subagent keeps its own
        tools and instructions.
      </p>
    </div>
  );
}
