import { type ReactElement, type ReactNode, useState } from 'react';
import { cn } from '@/utils/classNames';
import { CopyButton } from '../../shared/primitives/CopyButton';
import { Pill } from '../../shared/primitives/Pill';

/** A titled block of the page. `eyebrow` is the small label above the title. */
export function DocSection({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className='flex w-full flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        {eyebrow && (
          <span className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
            {eyebrow}
          </span>
        )}
        <h2 className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
          {title}
        </h2>
        {intro && <p className='text-sm leading-[22px] text-foreground/70'>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** A row of headline numbers. */
export function StatRow({ stats }: { stats: { value: string; label: string }[] }): ReactElement {
  return (
    <div className='grid w-full grid-cols-2 gap-3 sm:grid-cols-4'>
      {stats.map(stat => (
        <div
          key={stat.label}
          className='flex flex-col gap-0.5 rounded-2xl border border-border bg-card px-4 py-3'
        >
          <span className='text-xl font-semibold leading-7 tracking-[-0.4px] text-foreground'>
            {stat.value}
          </span>
          <span className='text-xs leading-4 text-muted-foreground'>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface Feature {
  title: string;
  body: string;
  /** A prompt or a line of code that shows the feature in use. */
  example?: string;
}

/** Two-column grid of capabilities, each with an optional example. */
export function FeatureGrid({ features }: { features: Feature[] }): ReactElement {
  return (
    <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
      {features.map(feature => (
        <div
          key={feature.title}
          className='flex flex-col gap-2 rounded-2xl border border-border bg-card p-4'
        >
          <span className='text-sm font-semibold leading-5 text-foreground'>{feature.title}</span>
          <p className='text-xs leading-5 text-foreground/70'>{feature.body}</p>
          {feature.example && (
            <code className='mt-auto block rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] leading-[18px] text-foreground/80'>
              {feature.example}
            </code>
          )}
        </div>
      ))}
    </div>
  );
}

/** A numbered setup step. */
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='flex w-full gap-3'>
      <div className='flex flex-col items-center'>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground'>
          {n}
        </span>
        <span className='mt-1 w-px flex-1 bg-border' aria-hidden />
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-3 pb-6'>
        <h3 className='text-sm font-semibold leading-6 text-foreground'>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Text({ children }: { children: ReactNode }): ReactElement {
  return <p className='text-sm leading-[22px] text-foreground/80'>{children}</p>;
}

export function InlineCode({ children }: { children: ReactNode }): ReactElement {
  return (
    <code className='rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground'>
      {children}
    </code>
  );
}

export function CodeBlock({
  code,
  trackName,
  caption,
}: {
  code: string;
  trackName: string;
  caption?: string;
}): ReactElement {
  return (
    <div className='flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card'>
      {caption && (
        <div className='border-b border-border px-4 py-2 font-mono text-[11px] text-muted-foreground'>
          {caption}
        </div>
      )}
      <div className='flex items-start gap-2 p-4'>
        <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/80'>
          {code}
        </pre>
        <CopyButton value={code} label='Copy' trackName={trackName} />
      </div>
    </div>
  );
}

/** Segmented control; renders the selected option's content below it. */
export function Tabs<T extends string>({
  options,
  render,
  trackPrefix,
}: {
  options: readonly T[];
  render: (option: T) => ReactNode;
  trackPrefix: string;
}): ReactElement {
  const [active, setActive] = useState<T>(options[0] as T);
  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='flex w-fit flex-wrap gap-1 rounded-xl bg-muted p-1' role='tablist'>
        {options.map(option => (
          <button
            key={option}
            type='button'
            role='tab'
            aria-selected={active === option}
            onClick={() => setActive(option)}
            data-track-category='Developer tools'
            data-track-name={`${trackPrefix}: ${option}`}
            className={cn(
              'h-7 rounded-lg px-3 text-xs font-medium transition-colors',
              active === option
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option}
          </button>
        ))}
      </div>
      {render(active)}
    </div>
  );
}

/** A two-column reference table: a monospace name and what it does. */
export function RefTable({
  rows,
}: {
  rows: { name: string; description: string; tag?: { label: string; write: boolean } }[];
}): ReactElement {
  return (
    <div className='w-full overflow-hidden rounded-2xl border border-border bg-card'>
      {rows.map((row, i) => (
        <div
          key={row.name}
          className={cn(
            'flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-4',
            i > 0 && 'border-t border-border',
          )}
        >
          <div className='flex shrink-0 items-center gap-2 sm:w-[240px]'>
            <code className='truncate font-mono text-xs leading-5 text-foreground'>{row.name}</code>
            {row.tag && <Pill tone={row.tag.write ? 'warning' : 'neutral'}>{row.tag.label}</Pill>}
          </div>
          <p className='min-w-0 flex-1 text-xs leading-5 text-foreground/70'>{row.description}</p>
        </div>
      ))}
    </div>
  );
}

/** A highlighted note: tips, warnings, prerequisites. */
export function Callout({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning';
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={cn(
        'w-full rounded-2xl border p-4 text-sm leading-[22px]',
        tone === 'warning'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          : 'border-border bg-muted/50 text-foreground/80',
      )}
    >
      {children}
    </div>
  );
}
