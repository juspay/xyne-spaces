import { logger, Event as LogEvent } from '../../../../utils/logger';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Tooltip } from '../../../ui/Tooltip/Tooltip';
import type {
  VariablePickerProps,
  VariableEntry,
  VariablePickerSource,
} from './VariablePicker.types';
import { acceptsVariable, flattenSource } from './VariablePicker.utils';

interface PickerGroup {
  groupKey: string;
  groupLabel: string;
  entries: Array<{ source: VariablePickerSource; entries: VariableEntry[] }>;
}

export function VariablePicker({
  sources,
  onSelect,
  onClose,
  targetEntityKind,
  targetLeafType,
}: VariablePickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const allGroups = useMemo<PickerGroup[]>(() => buildGroups(sources), [sources]);

  const groups = useMemo<PickerGroup[]>(() => {
    if (!targetEntityKind && !targetLeafType) return allGroups;
    const accept = (entry: VariableEntry): boolean =>
      acceptsVariable(entry, targetEntityKind, targetLeafType);
    const matching = allGroups
      .map(group => ({
        ...group,
        entries: group.entries
          .map(({ source, entries }) => ({ source, entries: entries.filter(accept) }))
          .filter(({ entries }) => entries.length > 0),
      }))
      .filter(group => group.entries.length > 0);
    return matching.length > 0 ? matching : allGroups;
  }, [allGroups, targetEntityKind, targetLeafType]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => defaultExpanded(groups));

  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      const stepGroups = groups.filter(g => g.groupKey !== 'trigger');
      stepGroups.forEach((g, i) => {
        if (next[g.groupKey] !== undefined) return;
        next[g.groupKey] = i === stepGroups.length - 1;
      });
      const triggerGroup = groups.find(g => g.groupKey === 'trigger');
      if (triggerGroup && next[triggerGroup.groupKey] === undefined) {
        next[triggerGroup.groupKey] = true;
      }
      return next;
    });
  }, [groups]);

  const lower = query.trim().toLowerCase();
  const matches = (e: VariableEntry): boolean =>
    e.path.toLowerCase().includes(lower) || e.label.toLowerCase().includes(lower);
  const filtered = lower
    ? groups
        .map(group => ({
          ...group,
          entries: group.entries
            .map(({ source, entries }) => ({
              source,
              entries: entries.filter(matches),
            }))
            .filter(({ entries }) => entries.length > 0),
        }))
        .filter(group => group.entries.length > 0)
    : groups;

  const handlePick = (entry: VariableEntry): void => {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_info',
      message: String('[automations] variable inserted'),
      context: [
        {
          sourceKey: entry.sourceKey,
          role: entry.role,
          path: entry.path,
        },
      ],
    });
    onSelect(entry);
    onClose();
  };

  const totalEntries = filtered.reduce(
    (sum, group) => sum + group.entries.reduce((g, s) => g + s.entries.length, 0),
    0,
  );

  return (
    <div
      data-slot='automation-variable-picker'
      className={cn('w-[340px] max-h-[400px] flex flex-col overflow-hidden')}
    >
      <div className='flex items-center gap-2 px-3 py-2 border-b border-border'>
        <Search className='size-4 text-muted-foreground flex-shrink-0' />
        <input
          ref={searchRef}
          type='text'
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search variables…'
          data-track-category='automation-builder'
          data-track-name='variable-picker-search'
          className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
        />
      </div>
      <div className='flex-1 overflow-y-auto py-1'>
        {totalEntries === 0 ? (
          <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
            {sources.length === 0
              ? 'No upstream variables yet — add a trigger first.'
              : 'No variables match your search.'}
          </div>
        ) : (
          <>
            {filtered.map(group => {
              const isOpen = lower.length > 0 ? true : (expanded[group.groupKey] ?? false);
              const total = group.entries.reduce((sum, s) => sum + s.entries.length, 0);
              return (
                <div key={group.groupKey} className='py-0.5'>
                  <button
                    type='button'
                    onClick={() =>
                      setExpanded(prev => ({
                        ...prev,
                        [group.groupKey]: !(prev[group.groupKey] ?? false),
                      }))
                    }
                    data-track-category='automation-builder'
                    data-track-name={`variable-picker-toggle-group-${group.groupKey}`}
                    className={cn(
                      'w-full flex items-center gap-1.5 px-3 py-1.5 text-left',
                      'text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
                      'hover:bg-accent/40',
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown className='size-3' />
                    ) : (
                      <ChevronRight className='size-3' />
                    )}
                    <span className='flex-1 truncate normal-case text-foreground'>
                      {group.groupLabel}
                    </span>
                    <span className='text-[10px] font-normal text-muted-foreground/80'>
                      {total}
                    </span>
                  </button>
                  {isOpen &&
                    group.entries.map(({ source, entries }) => (
                      <div key={`${group.groupKey}::${source.role}`} className='ml-3'>
                        {group.groupKey !== 'trigger' && (
                          <div className='px-3 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70'>
                            {source.role}
                          </div>
                        )}
                        {entries.map(entry => (
                          <button
                            key={`${entry.sourceKey}::${entry.role}::${entry.path}`}
                            type='button'
                            onClick={() => handlePick(entry)}
                            data-track-category='automation-builder'
                            data-track-name='variable-picker-select'
                            className={cn(
                              'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left',
                              'text-sm text-foreground hover:bg-accent/40',
                            )}
                          >
                            <Tooltip content={entry.path} side='top' delayDuration={500}>
                              <span className='truncate'>{entry.path}</span>
                            </Tooltip>
                            <span className='ml-2 flex-shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground'>
                              {entry.leafType}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function buildGroups(sources: VariablePickerSource[]): PickerGroup[] {
  const order: string[] = [];
  const map = new Map<string, PickerGroup>();
  for (const source of sources) {
    let bucket = map.get(source.groupKey);
    if (!bucket) {
      bucket = {
        groupKey: source.groupKey,
        groupLabel: source.groupLabel,
        entries: [],
      };
      map.set(source.groupKey, bucket);
      order.push(source.groupKey);
    }
    bucket.entries.push({ source, entries: flattenSource(source) });
  }
  for (const group of map.values()) {
    group.entries.sort((a, b) => roleOrder(a.source.role) - roleOrder(b.source.role));
  }
  return order.map(key => map.get(key)).filter((g): g is PickerGroup => !!g);
}

function roleOrder(role: VariablePickerSource['role']): number {
  if (role === 'trigger') return 0;
  if (role === 'input') return 1;
  return 2;
}

function defaultExpanded(groups: PickerGroup[]): Record<string, boolean> {
  const stepGroups = groups.filter(g => g.groupKey !== 'trigger');
  const result: Record<string, boolean> = {};
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group) continue;
    if (group.groupKey === 'trigger') {
      result[group.groupKey] = true;
      continue;
    }
    const stepIndex = stepGroups.indexOf(group);
    result[group.groupKey] = stepIndex === stepGroups.length - 1;
  }
  return result;
}
