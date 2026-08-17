import { type ReactElement, type ReactNode } from 'react';
import { InformationCircle, LockClose } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';

export function DetailSectionHeading({
  label,
  info,
  trailing,
  trailingAlign = 'inline',
}: {
  label: string;
  info?: string;
  trailing?: ReactNode;
  trailingAlign?: 'inline' | 'end';
}): ReactElement {
  return (
    <div className='flex w-full items-center gap-2'>
      <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
        {label}
      </span>
      {info && (
        <Tooltip side='top' content={info}>
          <span className='inline-flex'>
            <InformationCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />
          </span>
        </Tooltip>
      )}
      {trailing && (
        <span className={cn('flex shrink-0 items-center', trailingAlign === 'end' && 'ml-auto')}>
          {trailing}
        </span>
      )}
    </div>
  );
}

export function DetailCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('w-full rounded-2xl border border-border bg-card', className)}>
      {children}
    </div>
  );
}

export function DetailSection({
  label,
  info,
  trailing,
  trailingAlign,
  children,
}: {
  label: string;
  info?: string;
  trailing?: ReactNode;
  trailingAlign?: 'inline' | 'end';
  children: ReactNode;
}): ReactElement {
  return (
    <section className='flex w-full flex-col gap-3'>
      <DetailSectionHeading
        label={label}
        {...(info === undefined ? {} : { info })}
        {...(trailing === undefined ? {} : { trailing })}
        {...(trailingAlign === undefined ? {} : { trailingAlign })}
      />
      {children}
    </section>
  );
}

export function DetailRow({
  title,
  hint,
  children,
  last = false,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  last?: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-between gap-4 px-4 py-3',
        !last && 'border-b border-border',
      )}
    >
      <div className='flex min-w-0 flex-col gap-0.5'>
        <span className='truncate text-sm font-medium leading-5 text-foreground'>{title}</span>
        {hint && (
          <span className='truncate text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
            {hint}
          </span>
        )}
      </div>
      {children && <div className='flex shrink-0 items-center gap-2'>{children}</div>}
    </div>
  );
}

export function DetailProse({ children }: { children: string }): ReactElement {
  return (
    <p className='whitespace-pre-wrap break-words p-4 text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
      {children}
    </p>
  );
}

export function DetailEmpty({ children }: { children: ReactNode }): ReactElement {
  return <p className='p-4 text-sm font-normal leading-5 text-muted-foreground'>{children}</p>;
}

/**
 * Centred empty state for a whole card — an icon, a headline, a line of
 * explanation, and an optional call to action.
 */
export function DetailEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
    >
      <span
        className='flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground'
        aria-hidden
      >
        {icon}
      </span>
      <span className='flex flex-col gap-1'>
        <span className='text-base font-semibold leading-5 text-foreground/80'>{title}</span>
        <span className='text-sm font-normal leading-5 text-muted-foreground'>{description}</span>
      </span>
      {action}
    </div>
  );
}

export function DetailTabPlaceholder({ label }: { label: string }): ReactElement {
  return (
    <div className='flex w-full flex-col gap-3'>
      <DetailSectionHeading label={label} />
      <DetailCard>
        <DetailEmpty>Coming next.</DetailEmpty>
      </DetailCard>
    </div>
  );
}

export function ReadOnlyBadge(): ReactElement {
  return (
    <span className='flex h-4 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[10px] font-medium leading-4 tracking-[0.02em] text-muted-foreground'>
      <LockClose className='size-2.5 shrink-0' aria-hidden />
      Read only
    </span>
  );
}

export function DetailLockedNote({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex w-full items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5'>
      <LockClose className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
      <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
        {children}
      </span>
    </div>
  );
}

export function DetailValue({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className='max-w-[280px] truncate text-sm font-normal leading-5 text-foreground'>
      {children}
    </span>
  );
}
