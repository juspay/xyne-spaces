import { useCallback, useEffect, useState } from 'react';

export const DESK_TABLE_BUILTIN_COLUMNS = [
  { key: 'assignee', label: 'Assignee' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'status', label: 'Status Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'stage', label: 'Stage' },
  { key: 'tags', label: 'Labels' },
] as const;

const DEFAULT_COLUMN_KEYS = DESK_TABLE_BUILTIN_COLUMNS.map(column => column.key as string);

const storageKey = (channelId: string): string => `desk-table-columns-${channelId}`;

const readColumns = (channelId: string | null): Set<string> => {
  if (!channelId) return new Set(DEFAULT_COLUMN_KEYS);
  try {
    const raw = localStorage.getItem(storageKey(channelId));
    if (!raw) return new Set(DEFAULT_COLUMN_KEYS);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_COLUMN_KEYS);
    return new Set(parsed.filter((key): key is string => typeof key === 'string'));
  } catch {
    return new Set(DEFAULT_COLUMN_KEYS);
  }
};

export function useDeskTableColumns(channelId: string | null): {
  selectedColumnKeys: Set<string>;
  toggleColumn: (key: string, visible: boolean) => void;
} {
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(() =>
    readColumns(channelId),
  );

  useEffect(() => {
    setSelectedColumnKeys(readColumns(channelId));
  }, [channelId]);

  const toggleColumn = useCallback(
    (key: string, visible: boolean): void => {
      setSelectedColumnKeys(prev => {
        const next = new Set(prev);
        if (visible) next.add(key);
        else next.delete(key);
        if (channelId) {
          try {
            localStorage.setItem(storageKey(channelId), JSON.stringify([...next]));
          } catch {
            // Storage full or unavailable (private mode) — selection still applies in-memory.
          }
        }
        return next;
      });
    },
    [channelId],
  );

  return { selectedColumnKeys, toggleColumn };
}
