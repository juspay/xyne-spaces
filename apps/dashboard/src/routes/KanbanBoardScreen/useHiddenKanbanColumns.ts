import { useCallback, useRef, useState } from 'react';

/**
 * Columns parked in the hidden-columns panel, per device. Keyed by the board
 * scope plus the stage ids themselves, so a board whose stages changed comes
 * back with everything visible instead of hiding a stage that got reused.
 */
const HIDDEN_COLUMNS_PREFIX = 'xyne:kanban-hidden-columns:';

const readHiddenColumns = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(HIDDEN_COLUMNS_PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

export const useHiddenKanbanColumns = (
  scopeKey: string,
): {
  hiddenColumnIds: string[];
  hideColumn: (stageId: string) => void;
  unhideColumn: (stageId: string) => void;
  showAllColumns: () => void;
} => {
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);

  const seededScopeKeyRef = useRef<string | null>(null);
  if (seededScopeKeyRef.current !== scopeKey) {
    // First render, or the board switched to a different set of stages.
    seededScopeKeyRef.current = scopeKey;
    setHiddenColumnIds(readHiddenColumns(scopeKey));
  }

  const persist = useCallback(
    (next: string[]) => {
      setHiddenColumnIds(next);
      try {
        localStorage.setItem(HIDDEN_COLUMNS_PREFIX + scopeKey, JSON.stringify(next));
      } catch {
        // Storage blocked or full — the selection lives for this session only.
      }
    },
    [scopeKey],
  );

  const hideColumn = useCallback(
    (stageId: string) => {
      if (hiddenColumnIds.includes(stageId)) return;
      persist([...hiddenColumnIds, stageId]);
    },
    [hiddenColumnIds, persist],
  );

  const unhideColumn = useCallback(
    (stageId: string) => persist(hiddenColumnIds.filter(id => id !== stageId)),
    [hiddenColumnIds, persist],
  );

  const showAllColumns = useCallback(() => persist([]), [persist]);

  return { hiddenColumnIds, hideColumn, unhideColumn, showAllColumns };
};
