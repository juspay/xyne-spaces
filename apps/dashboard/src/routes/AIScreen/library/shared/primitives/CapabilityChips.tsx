import { type ReactElement, type ReactNode } from 'react';
import { InformationCircle, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { cn } from '@/utils/classNames';
import { VerifiedTick } from '../pickers/mcp/McpIdentity';
import {
  TWIN_STROKE_CLASS,
  TWIN_SURFACE_FILL_CLASS,
  type DetailTypeScale,
} from './DetailPrimitives';

export const CAPABILITY_LABEL_CLASS =
  'text-sm font-[550] leading-[1.2] tracking-[-0.1px] text-foreground';

export function CapabilityChip({
  icon,
  label,
  secondary,
  verified = false,
  onRemove,
  radius = '10',
  removeTrackName = 'Remove capability chip',
  typeScale = 'library',
}: {
  icon: ReactNode;
  label: string;
  secondary?: string;
  verified?: boolean;
  onRemove?: (() => void) | undefined;
  radius?: '10' | '12';
  removeTrackName?: string;
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <span
      title={secondary ? `${label} · ${secondary}` : label}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 overflow-hidden py-1 pl-1 pr-2',
        typeScale === 'twin'
          ? TWIN_SURFACE_FILL_CLASS
          : cn('bg-foreground/[0.06]', TWIN_STROKE_CLASS),
        radius === '12' ? 'rounded-xl' : 'rounded-[10px]',
      )}
    >
      {icon}
      <span className='flex min-w-0 items-center gap-1'>
        <span className='max-w-[220px] truncate text-sm font-[550] leading-none text-foreground'>
          {label}
        </span>
        {verified && <VerifiedTick />}
        {secondary && (
          <span className='max-w-[160px] truncate text-sm font-[450] leading-none text-foreground/40'>
            {secondary}
          </span>
        )}
      </span>
      {onRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          data-track-category='Claw Agents'
          data-track-name={removeTrackName}
          className='inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-3' aria-hidden />
        </button>
      )}
    </span>
  );
}

export function CapabilityRow({
  label,
  info,
  addLabel,
  canEdit,
  onAdd,
  showAdd = true,
  addTrackName = 'Add capability',
  children,
}: {
  label: string;
  info: string;
  addLabel: string;
  canEdit: boolean;
  onAdd: () => void;
  showAdd?: boolean;
  addTrackName?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <span className={CAPABILITY_LABEL_CLASS}>{label}</span>
          <Tooltip side='top' content={info}>
            <span className='inline-flex'>
              <InformationCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />
            </span>
          </Tooltip>
        </div>
        {canEdit && showAdd && (
          <button
            type='button'
            onClick={onAdd}
            aria-label={addLabel}
            data-track-category='Claw Agents'
            data-track-name={addTrackName}
            className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <PlusDefault className='size-4' aria-hidden />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function CapabilityChipRow({
  gap = 'loose',
  children,
}: {
  gap?: 'loose' | 'tight';
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('flex flex-wrap items-start', gap === 'tight' ? 'gap-2' : 'gap-2.5')}>
      {children}
    </div>
  );
}
