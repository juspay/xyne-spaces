import type { ReactElement, ReactNode } from 'react';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import type { View } from '../AppsAnalytics.types';

/** A titled card; `action` sits at the top right (the Chart/Table toggle). */
export const AnalyticsCard = ({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement => (
  <section className='flex flex-col gap-4 rounded-2xl border border-border bg-background p-5'>
    <header className='flex items-start justify-between gap-3'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <h3 className='text-sm font-medium text-foreground'>{title}</h3>
        {subtitle ? <p className='text-xs text-muted-foreground'>{subtitle}</p> : null}
      </div>
      {action}
    </header>
    {children}
  </section>
);

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' },
];

export const ViewToggle = ({
  view,
  onChange,
  trackName,
}: {
  view: View;
  onChange: (view: View) => void;
  trackName: string;
}): ReactElement => (
  <SegmentedToggle
    options={VIEW_OPTIONS}
    value={view}
    onChange={onChange}
    trackCategory='Apps'
    trackPrefix={trackName}
  />
);

/** Legend for two or more series: a swatch shaped like the mark (a rect, for bars) and its name. */
export const Legend = ({
  items,
}: {
  items: { key: string; label: string; color: string }[];
}): ReactElement => (
  <ul className='flex flex-wrap items-center gap-x-4 gap-y-1'>
    {items.map(s => (
      <li key={s.key} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
        <span
          className='size-2.5 rounded-[2px]'
          style={{ background: s.color }}
          aria-hidden='true'
        />
        {s.label}
      </li>
    ))}
  </ul>
);
