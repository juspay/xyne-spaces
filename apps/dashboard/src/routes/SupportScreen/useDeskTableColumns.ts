import { useCallback, useEffect, useState } from 'react';

export const DESK_TABLE_BUILTIN_COLUMNS = [
  { key: 'createdAt', label: 'Created at' },
  { key: 'age', label: 'Age' },
  { key: 'updatedAt', label: 'Last updated' },
  { key: 'createdBy', label: 'Created by' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'status', label: 'Status Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'stage', label: 'Stage' },
  { key: 'tags', label: 'Labels' },
] as const;

const DEFAULT_COLUMN_KEYS = DESK_TABLE_BUILTIN_COLUMNS.map(column => column.key as string);

const storageKey = (channelId: string): string => `desk-table-columns-${channelId}`;

const CURRENT_COLUMNS_VERSION = 4;

// Adding a builtin column means bumping the version and listing its key here,
// or desks with saved column choices never see it.
const COLUMNS_ADDED_IN_VERSION: ReadonlyMap<number, readonly string[]> = new Map([
  [2, ['createdAt']],
  [3, ['age']],
  [4, ['updatedAt', 'createdBy']],
]);

const withColumnsAddedSince = (version: number, columns: Set<string>): Set<string> => {
  const next = new Set(columns);
  for (let v = version + 1; v <= CURRENT_COLUMNS_VERSION; v += 1) {
    for (const key of COLUMNS_ADDED_IN_VERSION.get(v) ?? []) next.add(key);
  }
  return next;
};

interface StoredDeskTableColumns {
  version: number;
  columns: string[];
}

const writeColumns = (channelId: string, columns: Set<string>): void => {
  const value: StoredDeskTableColumns = {
    version: CURRENT_COLUMNS_VERSION,
    columns: [...columns],
  };
  localStorage.setItem(storageKey(channelId), JSON.stringify(value));
};

const readColumns = (channelId: string | null): Set<string> => {
  if (!channelId) return new Set(DEFAULT_COLUMN_KEYS);
  try {
    const raw = localStorage.getItem(storageKey(channelId));
    if (!raw) return new Set(DEFAULT_COLUMN_KEYS);
    const parsed: unknown = JSON.parse(raw);
    // The original format was a bare array of keys — treat it as version 1.
    if (Array.isArray(parsed)) {
      const migrated = withColumnsAddedSince(
        1,
        new Set(parsed.filter((key): key is string => typeof key === 'string')),
      );
      writeColumns(channelId, migrated);
      return migrated;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<StoredDeskTableColumns>).version === 'number' &&
      Array.isArray((parsed as Partial<StoredDeskTableColumns>).columns)
    ) {
      const stored = parsed as StoredDeskTableColumns;
      const columns = new Set(
        stored.columns.filter((key): key is string => typeof key === 'string'),
      );
      // Ahead of this build (user rolled back) — leave their choices untouched.
      if (stored.version >= CURRENT_COLUMNS_VERSION) return columns;
      const migrated = withColumnsAddedSince(stored.version, columns);
      writeColumns(channelId, migrated);
      return migrated;
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
