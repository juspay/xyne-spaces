import { useCallback, useEffect, useState } from 'react';
import { DESK_LIST_TOGGLEABLE_COLUMNS } from '../../components/Tickets/TicketListView/ticketListColumns';

const DEFAULT_LIST_COLUMN_KEYS = new Set(DESK_LIST_TOGGLEABLE_COLUMNS.map(c => c.key as string));

const storageKey = (channelId: string): string => `desk-list-columns-${channelId}`;

const CURRENT_VERSION = 1;

interface StoredDeskListColumns {
  version: number;
  columns: string[];
}

const writeColumns = (channelId: string, columns: Set<string>): void => {
  const value: StoredDeskListColumns = {
    version: CURRENT_VERSION,
    columns: [...columns],
  };
  localStorage.setItem(storageKey(channelId), JSON.stringify(value));
};

const readColumns = (channelId: string | null): Set<string> => {
  if (!channelId) return new Set(DEFAULT_LIST_COLUMN_KEYS);
  try {
    const raw = localStorage.getItem(storageKey(channelId));
    if (!raw) return new Set(DEFAULT_LIST_COLUMN_KEYS);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((k): k is string => typeof k === 'string'));
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<StoredDeskListColumns>).version === 'number' &&
      Array.isArray((parsed as Partial<StoredDeskListColumns>).columns)
    ) {
      const stored = parsed as StoredDeskListColumns;
      return new Set(stored.columns.filter((k): k is string => typeof k === 'string'));
    }
    return new Set(DEFAULT_LIST_COLUMN_KEYS);
  } catch {
    return new Set(DEFAULT_LIST_COLUMN_KEYS);
  }
};

export function useDeskListColumns(channelId: string | null): {
  selectedColumnKeys: Set<string>;
  toggleColumn: (key: string, visible: boolean) => void;
  setColumns: (keys: Set<string>) => void;
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
            // Storage full or unavailable — selection still applies in-memory.
          }
        }
        return next;
      });
    },
    [channelId],
  );

  const setColumns = useCallback(
    (keys: Set<string>): void => {
      setSelectedColumnKeys(keys);
      if (channelId) {
        try {
          writeColumns(channelId, keys);
        } catch {
          // Storage full or unavailable — selection still applies in-memory.
        }
      }
    },
    [channelId],
  );

  return { selectedColumnKeys, toggleColumn, setColumns };
}
