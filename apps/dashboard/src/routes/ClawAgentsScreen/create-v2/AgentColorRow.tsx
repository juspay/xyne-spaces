import { type ReactElement } from 'react';
import { CheckTickSingle } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { COLORS } from '../create/wizardState';

interface AgentColorRowProps {
  color: string;
  onChange: (color: string) => void;
}

function haloFor(value: string, selected: boolean): string | undefined {
  if (!selected) return undefined;
  return `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${value}66`;
}

export function AgentColorRow({ color, onChange }: AgentColorRowProps): ReactElement {
  return (
    <div
      role='radiogroup'
      aria-label='Agent color'
      className='flex w-full flex-wrap items-center gap-2.5'
    >
      {COLORS.map(value => {
        const selected = value === color;
        return (
          <button
            key={value}
            type='button'
            role='radio'
            aria-checked={selected}
            aria-label={`Color ${value}`}
            title={value}
            onClick={() => onChange(value)}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: pick color'
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-white transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              !selected && 'opacity-80 hover:scale-110 hover:opacity-100',
            )}
            style={{ backgroundColor: value, boxShadow: haloFor(value, selected) }}
          >
            {selected && <CheckTickSingle className='size-3 drop-shadow-sm' aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
