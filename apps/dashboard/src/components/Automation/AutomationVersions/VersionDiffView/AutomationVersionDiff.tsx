import { useMemo } from 'react';
import { AlertCircle, Minus, Plus, RefreshCw } from 'lucide-react';
import type { Automation } from '../../Automation.types';
import {
  buildAutomationVersionDiff,
  countChanges,
  type ArrayDiff,
  type ArrayItemDiff,
  type DiffNode,
  type DiffStatus,
  type ObjectDiff,
  type ScalarDiff,
  type TriggerDiff,
} from './automationDiff';

interface AutomationVersionDiffProps {
  from: Automation;
  to: Automation;
}

function statusClasses(status: DiffStatus): string {
  switch (status) {
    case 'added':
      return 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400';
    case 'removed':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
    case 'modified':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function statusBadgeClasses(status: DiffStatus): string {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium';
  return `${base} ${statusClasses(status)}`;
}

function StatusBadge({ status }: { status: DiffStatus }): React.ReactElement {
  const icon =
    status === 'added' ? (
      <Plus className='size-3' />
    ) : status === 'removed' ? (
      <Minus className='size-3' />
    ) : status === 'modified' ? (
      <RefreshCw className='size-3' />
    ) : (
      <AlertCircle className='size-3' />
    );
  return (
    <span className={statusBadgeClasses(status)}>
      {icon}
      <span className='capitalize'>{status}</span>
    </span>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value as { toString(): string });
  }
}

function isEmptyDiff(node: DiffNode): boolean {
  if (node.kind === 'scalar') {
    return node.status === 'unchanged';
  }
  if (node.kind === 'array') {
    return node.status === 'unchanged' || node.items.every(isEmptyArrayItem);
  }
  return (
    node.status === 'unchanged' || Object.values(node.fields).every(isEmptyDiff)
  );
}

function isEmptyArrayItem(item: ArrayItemDiff): boolean {
  return item.status === 'unchanged' || isEmptyDiff(item.value);
}

function ScalarDiffRow({ diff, label }: { diff: ScalarDiff; label: string }): React.ReactElement | null {
  if (diff.status === 'unchanged') return null;

  return (
    <div className='flex items-start gap-3 py-1'>
      <span className='min-w-[120px] text-xs font-medium text-muted-foreground'>{label}</span>
      <div className='flex flex-1 flex-col gap-1 text-xs'>
        {diff.status !== 'added' && (
          <span className='line-through decoration-red-400 text-muted-foreground'>
            {formatValue(diff.oldValue)}
          </span>
        )}
        {diff.status !== 'removed' && (
          <span className='font-medium text-foreground'>{formatValue(diff.newValue)}</span>
        )}
      </div>
      <StatusBadge status={diff.status} />
    </div>
  );
}

function ObjectDiffFields({ diff }: { diff: ObjectDiff }): React.ReactElement | null {
  const keys = Object.keys(diff.fields).filter(key => {
    const field = diff.fields[key];
    return field && !isEmptyDiff(field);
  });
  if (keys.length === 0) return null;

  return (
    <div className='flex flex-col gap-0.5 rounded-md border border-border/50 bg-background p-2'>
      {keys.map(key => {
        const field = diff.fields[key]!;
        if (field.kind === 'scalar') {
          return <ScalarDiffRow key={key} diff={field} label={key} />;
        }
        if (field.kind === 'array') {
          return (
            <div key={key} className='py-1'>
              <div className='mb-1 text-xs font-medium text-muted-foreground'>{key}</div>
              <ArrayDiffList diff={field} />
            </div>
          );
        }
        return (
          <div key={key} className='py-1'>
            <div className='mb-1 flex items-center gap-2'>
              <span className='text-xs font-medium text-muted-foreground'>{key}</span>
              {field.status !== 'unchanged' && <StatusBadge status={field.status} />}
            </div>
            <ObjectDiffFields diff={field} />
          </div>
        );
      })}
    </div>
  );
}

function ArrayDiffList({ diff }: { diff: ArrayDiff }): React.ReactElement | null {
  const visibleItems = diff.items.filter(item => !isEmptyArrayItem(item));
  if (visibleItems.length === 0) return null;

  return (
    <div className='flex flex-col gap-1'>
      {visibleItems.map(item => (
        <ArrayItemDiffRow key={`${item.id ?? ''}-${item.index}`} item={item} />
      ))}
    </div>
  );
}

function stepTitle(stepObj: ObjectDiff): string {
  const typeField = stepObj.fields['type'] as ScalarDiff<string> | undefined;
  if (typeField?.newValue) return String(typeField.newValue);
  if (typeField?.oldValue) return String(typeField.oldValue);
  return 'Step';
}

function stepId(stepObj: ObjectDiff): string {
  const idField = stepObj.fields['id'] as ScalarDiff<string> | undefined;
  return String(idField?.newValue ?? idField?.oldValue ?? '');
}

function ArrayItemDiffRow({ item }: { item: ArrayItemDiff }): React.ReactElement | null {
  if (item.value.kind === 'object') {
    const title = stepTitle(item.value);
    const id = stepId(item.value);
    return (
      <div
        className={`rounded-md border px-3 py-2 ${
          item.status === 'added'
            ? 'border-green-500/30 bg-green-500/5'
            : item.status === 'removed'
              ? 'border-red-500/30 bg-red-500/5'
              : item.status === 'modified'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-border'
        }`}
      >
        <div className='mb-1 flex items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-sm font-medium text-foreground'>{title}</span>
            {id && <span className='text-[10px] text-muted-foreground'>{id}</span>}
          </div>
          <StatusBadge status={item.status} />
        </div>
        <ObjectDiffFields diff={item.value} />
      </div>
    );
  }

  if (item.value.kind === 'scalar') {
    return (
      <div className='flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1 text-xs'>
        <span>{formatValue(item.value.newValue ?? item.value.oldValue)}</span>
        <StatusBadge status={item.status} />
      </div>
    );
  }

  return <ArrayDiffList diff={item.value} />;
}

function TriggerDiffSection({ diff }: { diff: TriggerDiff }): React.ReactElement | null {
  const typeChanged = diff.type.status !== 'unchanged';
  const configChanged = !isEmptyDiff(diff.config);
  if (!typeChanged && !configChanged) return null;

  return (
    <section className='rounded-lg border border-border bg-card p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <h3 className='text-sm font-semibold text-foreground'>Trigger</h3>
        <StatusBadge status={diff.status} />
      </div>
      {typeChanged && <ScalarDiffRow diff={diff.type} label='type' />}
      {configChanged && <ObjectDiffFields diff={diff.config} />}
    </section>
  );
}

function StepList({ diff }: { diff: ArrayDiff }): React.ReactElement | null {
  const visibleItems = diff.items.filter(item => !isEmptyArrayItem(item));
  if (visibleItems.length === 0) return null;

  return (
    <section className='rounded-lg border border-border bg-card p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <h3 className='text-sm font-semibold text-foreground'>Steps</h3>
        <StatusBadge status={diff.status} />
      </div>
      <ArrayDiffList diff={diff} />
    </section>
  );
}

export function AutomationVersionDiff({
  from,
  to,
}: AutomationVersionDiffProps): React.ReactElement {
  const diff = useMemo(() => buildAutomationVersionDiff(from, to), [from, to]);
  const changeCount = useMemo(() => countChanges(diff), [diff]);

  if (changeCount === 0) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        No differences between these versions.
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col gap-4 overflow-auto p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium text-foreground'>
            {changeCount} change{changeCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className='flex items-center gap-3'>
          <span className={statusBadgeClasses('added')}>Added</span>
          <span className={statusBadgeClasses('removed')}>Removed</span>
          <span className={statusBadgeClasses('modified')}>Modified</span>
        </div>
      </div>

      <div className='rounded-lg border border-border bg-card p-4'>
        <h3 className='mb-3 text-sm font-semibold text-foreground'>Automation</h3>
        <div className='flex flex-col gap-1'>
          <ScalarDiffRow diff={diff.name} label='name' />
          <ScalarDiffRow diff={diff.description} label='description' />
          <ScalarDiffRow diff={diff.status} label='status' />
          <ScalarDiffRow diff={diff.eventType} label='event type' />

          {!isEmptyDiff(diff.schedule) && (
            <div className='py-1'>
              <div className='mb-1 flex items-center gap-2'>
                <span className='text-xs font-medium text-muted-foreground'>schedule</span>
                {diff.schedule.status !== 'unchanged' && (
                  <StatusBadge status={diff.schedule.status} />
                )}
              </div>
              {diff.schedule.kind === 'object' ? (
                <ObjectDiffFields diff={diff.schedule} />
              ) : diff.schedule.kind === 'array' ? (
                <ArrayDiffList diff={diff.schedule} />
              ) : (
                <ScalarDiffRow diff={diff.schedule} label='value' />
              )}
            </div>
          )}
        </div>
      </div>

      <TriggerDiffSection diff={diff.trigger} />
      <StepList diff={diff.steps} />
    </div>
  );
}
