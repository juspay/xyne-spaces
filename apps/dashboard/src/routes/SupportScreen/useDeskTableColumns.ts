import { useCallback, useEffect, useState } from 'react';

export const DESK_TABLE_BUILTIN_COLUMNS = [
  { key: 'createdAt', label: 'Created at' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'status', label: 'Status Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'stage', label: 'Stage' },
  { key: 'tags', label: 'Labels' },
] as const;

const DEFAULT_COLUMN_KEYS = DESK_TABLE_BUILTIN_COLUMNS.map(column => column.key as string);

const storageKey = (channelId: string): string => `desk-table-columns-${channelId}`;

interface StoredDeskTableColumns {
  version: 2;
  columns: string[];
}

const writeColumns = (channelId: string, columns: Set<string>): void => {
  const value: StoredDeskTableColumns = { version: 2, columns: [...columns] };
  localStorage.setItem(storageKey(channelId), JSON.stringify(value));
};

const readColumns = (channelId: string | null): Set<string> => {
  if (!channelId) return new Set(DEFAULT_COLUMN_KEYS);
  try {
    const raw = localStorage.getItem(storageKey(channelId));
    if (!raw) return new Set(DEFAULT_COLUMN_KEYS);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Migrate the old array-only format once. Existing desks should gain the
      // new Created-at column without losing the user's other column choices.
      const migrated = new Set([
        ...parsed.filter((key): key is string => typeof key === 'string'),
        'createdAt',
      ]);
      writeColumns(channelId, migrated);
      return migrated;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Partial<StoredDeskTableColumns>).version === 2 &&
      Array.isArray((parsed as Partial<StoredDeskTableColumns>).columns)
    ) {
      return new Set(
        (parsed as StoredDeskTableColumns).columns.filter(
          (key): key is string => typeof key === 'string',
        ),
      );
    }
    return new Set(DEFAULT_COLUMN_KEYS);
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
            writeColumns(channelId, next);
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
