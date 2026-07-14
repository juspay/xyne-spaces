import { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return 'Not set';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const humanizeKey = (value: string): string =>
  value
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[a-z]/, char => char.toUpperCase());

export const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const DetailSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement => (
  <section className='flex flex-col gap-3'>
    <div className='flex flex-col gap-0.5'>
      <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
      {description && <p className='text-xs text-muted-foreground'>{description}</p>}
    </div>
    {children}
  </section>
);

export const EmptyPanel = ({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement => (
  <div className='rounded-lg border border-dashed border-border px-4 py-6 text-center'>
    <p className='text-sm font-medium text-foreground'>{title}</p>
    <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
  </div>
);

export const InfoRow = ({ label, value }: { label: string; value: ReactNode }): ReactElement => (
  <div className='flex items-center justify-between gap-4 py-2 text-sm'>
    <span className='shrink-0 text-muted-foreground'>{label}</span>
    <span className='min-w-0 truncate text-right text-foreground'>{value}</span>
  </div>
);

export const ChipList = ({ values }: { values: string[] }): ReactElement => (
  <div className='flex flex-wrap gap-1.5'>
    {values.map(value => (
      <Badge key={value} variant='outline' title={value}>
        {humanizeKey(value)}
      </Badge>
    ))}
  </div>
);
