import { useCallback, useMemo, useState } from 'react';

export function useTicketsSelection(allIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isSelecting = selectedIds.size > 0;
  const selectedCount = selectedIds.size;

  const allSelected = useMemo(() => {
    if (allIds.length === 0) return false;
    return allIds.every(id => selectedIds.has(id));
  }, [allIds, selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const enterSelection = useCallback((id: string) => {
    setSelectedIds(prev => new Set(prev).add(id));
  }, []);

  const toggleId = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (allIds.length === 0) return prev;
      const every = allIds.every(id => prev.has(id));
      return every ? new Set() : new Set(allIds);
    });
  }, [allIds]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    selectedCount,
    isSelecting,
    allSelected,
    clearSelection,
    enterSelection,
    toggleId,
    toggleSelectAll,
    isSelected,
  };
}
