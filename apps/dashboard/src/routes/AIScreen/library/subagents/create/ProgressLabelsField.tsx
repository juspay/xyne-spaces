import { type ReactElement } from 'react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { SubagentSectionLabel } from './SectionHeading';

const MAX_LABELS = 8;

interface ProgressLabelsFieldProps {
  labels: readonly string[];
  onChange: (next: string[]) => void;
}

export function ProgressLabelsField({ labels, onChange }: ProgressLabelsFieldProps): ReactElement {
  const atMax = labels.length >= MAX_LABELS;
  const isOnly = labels.length === 1;

  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <SubagentSectionLabel>Progress labels</SubagentSectionLabel>
          <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
            {labels.length} of {MAX_LABELS}
          </span>
        </div>
        <button
          type='button'
          onClick={() => onChange([...labels, ''])}
          disabled={atMax}
          aria-label='Add progress label'
          title={atMax ? `Up to ${MAX_LABELS} labels` : 'Add label'}
          data-track-category='Claw Agents'
          data-track-name='Create subagent v2: add progress label'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        Short statuses shown while the subagent works.
      </p>

      <div className='flex w-full flex-col gap-2'>
        {labels.map((label, index) => (
          <div key={index} className='flex w-full items-center gap-2'>
            <input
              value={label}
              onChange={e =>
                onChange(labels.map((item, i) => (i === index ? e.target.value : item)))
              }
              placeholder='Working…'
              aria-label={`Progress label ${index + 1}`}
              data-track-category='Claw Agents'
              data-track-name='Create subagent v2: progress label'
              className='h-11 min-w-0 flex-1 rounded-2xl border border-border bg-card px-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            />
            <button
              type='button'
              onClick={() => onChange(labels.filter((_, i) => i !== index))}
              // At least one label must survive — the runtime always shows one.
              disabled={isOnly}
              aria-label={`Remove progress label ${index + 1}`}
              title={isOnly ? 'At least one label is required' : 'Remove label'}
              data-track-category='Claw Agents'
              data-track-name='Create subagent v2: remove progress label'
              className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
            >
              <MultipleCrossCancelDefault className='size-4' aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
