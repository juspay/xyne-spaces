import { type ReactElement } from 'react';
import { CheckTickSquare, Square } from '@xyne/icons';
import type { IntegrationToolEntry } from '@/services/claw/clawToolsTypes';

export function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^[a-z]/, char => char.toUpperCase());
}

const ToolCheckbox = ({ checked }: { checked: boolean }): ReactElement =>
  checked ? (
    <CheckTickSquare variant='Solid' className='size-5 shrink-0 text-primary' aria-hidden />
  ) : (
    <Square className='size-5 shrink-0 text-border' aria-hidden />
  );

interface ToolRowProps {
  tool: IntegrationToolEntry;
  checked: boolean;
  onToggle: () => void;
}

export function ToolRow({ tool, checked, onToggle }: ToolRowProps): ReactElement {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      onClick={onToggle}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: toggle tool'
      className='flex w-full flex-col items-start gap-1 text-left'
    >
      <span className='flex w-full items-center gap-2'>
        <ToolCheckbox checked={checked} />
        <span className='min-w-0 truncate text-sm font-normal leading-[1.2] text-foreground'>
          {humanizeToolName(tool.name)}
        </span>
      </span>
      {tool.description && (
        <span className='w-full truncate pl-7 text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
          {tool.description}
        </span>
      )}
    </button>
  );
}
