import { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  Zap,
  ChevronDown,
  Loader2,
  Clock,
  MousePointerClick,
  Activity,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { EmailReceivedFilterForm } from './EmailReceivedFilterForm';
import { WebhookTriggerForm } from './WebhookTriggerForm';
import type { TriggerCardProps } from './TriggerCard.types';
import type { TriggerCatalogItem } from '../../Automation.types';

function ResolveIcon({
  name,
  className,
  fallback: Fallback = Zap,
}: {
  name: string | undefined;
  className?: string;
  fallback?: LucideIcon;
}): React.ReactElement {
  const Icon = name
    ? (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name]
    : undefined;
  const Component: LucideIcon = Icon ?? Fallback;
  return <Component className={className} />;
}

interface CategoryStyle {
  label: string;
  headerIcon: React.ReactNode;
  iconTint: string;
}

const CATEGORY_META: Record<string, CategoryStyle> = {
  manual: {
    label: 'On user action',
    headerIcon: <MousePointerClick className='size-3.5' />,
    iconTint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  timer: {
    label: 'On a schedule',
    headerIcon: <Clock className='size-3.5' />,
    iconTint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  event: {
    label: 'On a workspace event',
    headerIcon: <Activity className='size-3.5' />,
    iconTint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
};

const CATEGORY_ORDER = ['event', 'timer', 'manual', 'other'];

function categoryStyle(category: string): CategoryStyle {
  return (
    CATEGORY_META[category] ?? {
      label: category[0]?.toUpperCase() + category.slice(1),
      headerIcon: <Zap className='size-3.5' />,
      iconTint: 'bg-accent/40 text-foreground',
    }
  );
}

export function TriggerCard({
  trigger,
  catalog,
  schema,
  schemaLoading,
  onChangeType,
  onConfigChange,
  issues,
  view = 'event',
}: TriggerCardProps): React.ReactElement | null {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = catalog.find(c => c.type === trigger.type);
  const heading = selected?.name ?? trigger.type ?? 'Choose a trigger';
  const description = selected?.description;
  const noTrigger = !trigger.type || !selected;

  if (view === 'condition') {
    if (noTrigger) {
      return (
        <div className='rounded-md border border-dashed border-border bg-background/50 p-5 text-xs italic text-muted-foreground'>
          Pick a trigger above and its filters will appear here.
        </div>
      );
    }
    const scopeIssue = issues?.find(i => i.path === 'trigger.config');
    return (
      <div
        data-slot='automation-condition-card'
        className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'
      >
        {scopeIssue && (
          <div className='rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400'>
            {scopeIssue.message}
          </div>
        )}
        {schemaLoading ? (
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' aria-hidden='true' />
            Loading trigger filters…
          </div>
        ) : !schema ? (
          <div className='text-xs italic text-muted-foreground'>Filters unavailable.</div>
        ) : trigger.type === 'EMAIL_RECEIVED' ? (
          <EmailReceivedFilterForm
            schema={schema.configSchema}
            value={trigger.config}
            onChange={onConfigChange}
            issues={issues ?? null}
            pathPrefix='trigger.config.'
          />
        ) : trigger.type === 'WEBHOOK' ? (
          <WebhookTriggerForm
            value={trigger.config}
            onChange={onConfigChange}
            issues={issues ?? null}
            pathPrefix='trigger.config.'
          />
        ) : (
          <SchemaForm
            schema={schema.configSchema}
            value={trigger.config}
            onChange={onConfigChange}
            issues={issues ?? null}
            pathPrefix='trigger.config.'
          />
        )}
      </div>
    );
  }

  if (noTrigger) {
    return (
      <div
        data-slot='automation-trigger-card'
        className='flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-background p-5'
      >
        <div className='flex items-center gap-3'>
          <div
            aria-hidden='true'
            className='flex size-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400'
          >
            <Zap className='size-4' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Trigger
            </span>
            <span className='text-sm font-medium text-foreground'>{heading}</span>
          </div>
        </div>
        <TriggerEmptyStateBody catalog={catalog} currentType={trigger.type} onPick={onChangeType} />
      </div>
    );
  }

  return (
    <div
      data-slot='automation-trigger-card'
      className='flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-background p-5'
    >
      <div className='flex items-start gap-3'>
        <div
          aria-hidden='true'
          className='flex size-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400'
        >
          <Zap className='size-4' />
        </div>
        <div className='flex flex-col'>
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            Trigger
          </span>
          <span className='text-sm font-medium text-foreground'>{heading}</span>
          {description && <span className='mt-1 text-xs text-muted-foreground'>{description}</span>}
        </div>
      </div>

      <Popover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        align='end'
        side='bottom'
        sideOffset={4}
        className='w-[340px] max-h-[440px] overflow-hidden rounded-md p-0 flex flex-col'
        trigger={
          <button
            type='button'
            aria-label='Change trigger'
            aria-haspopup='listbox'
            aria-expanded={pickerOpen}
            className={cn(
              'flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs',
              'text-muted-foreground hover:text-foreground hover:bg-accent/40',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
            )}
          >
            Change
            <ChevronDown className='size-3' aria-hidden='true' />
          </button>
        }
      >
        <TriggerPickerContent
          catalog={catalog}
          currentType={trigger.type}
          onPick={type => {
            onChangeType(type);
            setPickerOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function TriggerEmptyStateBody({
  catalog,
  currentType,
  onPick,
}: {
  catalog: TriggerCatalogItem[];
  currentType: string;
  onPick: (type: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className='flex flex-wrap items-center justify-end gap-x-3 gap-y-2'>
      <p className='text-xs text-muted-foreground'>
        Pick a trigger to choose what fires this automation.
      </p>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align='end'
        side='bottom'
        sideOffset={4}
        className='w-[340px] max-h-[440px] overflow-hidden rounded-md p-0 flex flex-col'
        trigger={
          <button
            type='button'
            aria-label='Choose a trigger'
            aria-haspopup='listbox'
            aria-expanded={open}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1.5',
              'text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
            )}
          >
            <Search className='size-4' aria-hidden='true' />
            Choose a trigger
            <ChevronDown className='size-3.5' aria-hidden='true' />
          </button>
        }
      >
        <TriggerPickerContent
          catalog={catalog}
          currentType={currentType}
          onPick={type => {
            onPick(type);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function TriggerPickerContent({
  catalog,
  currentType,
  onPick,
}: {
  catalog: TriggerCatalogItem[];
  currentType: string;
  onPick: (type: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const grouped = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = lower
      ? catalog.filter(
          item =>
            item.name.toLowerCase().includes(lower) ||
            item.description?.toLowerCase().includes(lower) ||
            item.type.toLowerCase().includes(lower),
        )
      : catalog;

    const map = new Map<string, TriggerCatalogItem[]>();
    for (const item of filtered) {
      const key = item.category ?? 'other';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return CATEGORY_ORDER.filter(c => map.has(c))
      .map(c => ({ category: c, items: map.get(c)! }))
      .concat(
        Array.from(map.keys())
          .filter(c => !CATEGORY_ORDER.includes(c))
          .map(c => ({ category: c, items: map.get(c)! })),
      );
  }, [catalog, query]);

  const totalAfterFilter = grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <Search className='size-4 flex-shrink-0 text-muted-foreground' aria-hidden='true' />
        <input
          ref={searchRef}
          type='search'
          aria-label='Search triggers'
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search triggers…'
          data-track-category='automation-builder'
          data-track-name='trigger-picker-search'
          className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
        />
      </div>
      <div className='flex-1 overflow-y-auto py-1'>
        {catalog.length === 0 ? (
          <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
            No triggers registered.
          </div>
        ) : totalAfterFilter === 0 ? (
          <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
            No triggers match your search.
          </div>
        ) : (
          grouped.map(({ category, items }) => {
            const style = categoryStyle(category);
            return (
              <div key={category} className='py-0.5'>
                <div className='flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-sm',
                      style.iconTint,
                    )}
                  >
                    {style.headerIcon}
                  </span>
                  <span>{style.label}</span>
                </div>
                {items.map(item => (
                  <button
                    key={item.type}
                    type='button'
                    onClick={() => onPick(item.type)}
                    data-track-category='automation-builder'
                    data-track-name={`trigger-picker-select-${item.type}`}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                      'hover:bg-accent/40',
                      item.type === currentType && 'bg-accent/30',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 flex-shrink-0 items-center justify-center rounded-md',
                        style.iconTint,
                      )}
                    >
                      <ResolveIcon name={item.icon} className='size-3' />
                    </span>
                    <span className='flex flex-1 flex-col min-w-0'>
                      <span className='truncate text-sm text-foreground'>{item.name}</span>
                      {item.description && (
                        <span className='line-clamp-1 text-[11px] text-muted-foreground'>
                          {item.description}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
