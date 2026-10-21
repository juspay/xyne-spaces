import { useLayoutEffect, useState, type ReactElement, type ReactNode } from 'react';
import { GitBranch, Search } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Tooltip } from '../../../components/ui/Tooltip';
import { getStageStatusMeta, StageStatusIcon } from '../../../utils/board/stageStatusIcon';
import { cn } from '../../../utils/classNames';
import { TRACK_CATEGORY } from './SdlcReleases.utils';

export function EllipsisText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactElement {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = (): void => setClipped(node.scrollWidth > node.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return (): void => observer.disconnect();
  }, [node, text]);

  return (
    <span ref={setNode} className={cn('relative truncate', className)}>
      {text}
      {clipped && (
        <Tooltip
          content={text}
          side='bottom'
          delayDuration={200}
          className='max-w-sm whitespace-normal break-words'
        >
          <span aria-hidden className='absolute inset-y-0 right-0 w-[1.25em]' />
        </Tooltip>
      )}
    </span>
  );
}

export function StagePill({ name, status }: { name: string; status: string }): ReactElement {
  const meta = getStageStatusMeta(status);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.08em]',
        meta.bgColor,
      )}
      style={{ color: meta.cssVar }}
    >
      <StageStatusIcon status={status} />
      {name}
    </span>
  );
}

export function StatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}): ReactElement {
  return (
    <span
      className={cn(
        'rounded-[5px] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.08em]',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function RepoPill({ name }: { name: string }): ReactElement {
  return (
    <span className='flex h-[22px] items-center gap-1.5 rounded-[5px] border border-border px-2 text-xs text-muted-foreground'>
      <GitBranch size={12} />
      {name}
    </span>
  );
}

export function InfoCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className='flex flex-wrap items-center gap-4 rounded-xl border border-border bg-background px-5 py-4'>
      <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
        {icon}
      </span>
      <div className='flex min-w-[220px] flex-1 flex-col gap-1'>
        <span className='text-sm font-semibold text-foreground'>{title}</span>
        <span className='text-[13px] leading-normal text-muted-foreground'>{description}</span>
      </div>
      {action}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  trackName,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trackName: string;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={14}
        className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground'
      />
      <Input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className='h-8 pl-8'
        data-track-category={TRACK_CATEGORY}
        data-track-name={trackName}
      />
    </div>
  );
}

export function MenuItem({
  active = false,
  onClick,
  trackName,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  trackName: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Button
      variant='ghost'
      size='sm'
      onClick={onClick}
      className={cn('w-full justify-start font-normal', active && 'bg-muted font-medium')}
      data-track-category={TRACK_CATEGORY}
      data-track-name={trackName}
    >
      {children}
    </Button>
  );
}
