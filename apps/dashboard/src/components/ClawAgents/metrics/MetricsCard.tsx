import { ReactElement, ReactNode } from 'react';

export const MetricsCard = ({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Controls shown at the right of the header. */
  action?: ReactNode;
  children: ReactNode;
}): ReactElement => (
  <section className='rounded-xl border border-border bg-card p-5 shadow-sm'>
    <div className='mb-4 flex flex-wrap items-start justify-between gap-3'>
      <div className='min-w-0'>
        <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
        {description && <p className='mt-1 text-xs text-muted-foreground'>{description}</p>}
      </div>
      {action && <div className='flex flex-wrap items-center gap-2'>{action}</div>}
    </div>
    {children}
  </section>
);
