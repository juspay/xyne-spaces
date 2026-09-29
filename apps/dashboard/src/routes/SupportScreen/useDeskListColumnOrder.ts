import { useCallback, useEffect, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';

const storageKey = (channelId: string): string => `desk-list-column-order-${channelId}`;

const readOrder = (channelId: string | null): string[] => {
  if (!channelId) return [];
  try {
    const raw = localStorage.getItem(storageKey(channelId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
};

export function useDeskListColumnOrder(channelId: string | null): {
  columnOrder: string[];
  moveColumn: (orderedKeys: readonly string[], fromKey: string, toKey: string) => void;
} {
  const [columnOrder, setColumnOrder] = useState<string[]>(() => readOrder(channelId));

  useEffect(() => {
    setColumnOrder(readOrder(channelId));
  }, [channelId]);

  // Takes the full rendered order, since the stored one may omit columns added since it was saved.
  const moveColumn = useCallback(
    (orderedKeys: readonly string[], fromKey: string, toKey: string): void => {
      const from = orderedKeys.indexOf(fromKey);
      const to = orderedKeys.indexOf(toKey);
      if (from === -1 || to === -1 || from === to) return;
      const next = arrayMove([...orderedKeys], from, to);
      setColumnOrder(next);
      if (!channelId) return;
      try {
        localStorage.setItem(storageKey(channelId), JSON.stringify(next));
      } catch {
        // Storage unavailable — the order still applies for this session.
      }
    },
    [channelId],
  );

  return { columnOrder, moveColumn };
}
