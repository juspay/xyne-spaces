import { ReactElement, ReactNode } from 'react';

export const MetricsCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement => (
  <section className='rounded-xl border border-border bg-card p-5 shadow-sm'>
    <div className='mb-4'>
      <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
      {description && <p className='mt-1 text-xs text-muted-foreground'>{description}</p>}
    </div>
    {children}
  </section>
);
