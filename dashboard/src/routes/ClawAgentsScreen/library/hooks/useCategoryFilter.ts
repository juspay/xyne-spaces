import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AGENT_CATEGORIES, type AgentCategoryId } from '@/services/claw/agentCategory';
import type { LibraryFilterOption } from '../components/LibraryFilterMenu';

/**
 * Category filtering shared by the Agents, Skills and MCP tabs — they differ
 * only in which `groupBy` they hand over.
 *
 * The selection lives in `?category=` so the view is shareable, and is ignored
 * when it has no matches under the current search, so a stale pick can never
 * strand the user on an empty list.
 */
export function useCategoryFilter<T extends { id: string }>({
  items,
  groupBy,
}: {
  items: T[];
  groupBy: (items: T[]) => Map<AgentCategoryId, T[]>;
}): {
  filtered: T[];
  activeId: AgentCategoryId | null;
  setActive: (id: string | null) => void;
  options: LibraryFilterOption[];
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const grouped = useMemo(() => groupBy(items), [items, groupBy]);

  const rawCategory = searchParams.get('category');
  const requested: AgentCategoryId | null =
    rawCategory && AGENT_CATEGORIES.some(cat => cat.id === rawCategory)
      ? (rawCategory as AgentCategoryId)
      : null;
  const activeId = requested && (grouped.get(requested)?.length ?? 0) > 0 ? requested : null;

  const setActive = (id: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('category', id);
    else next.delete('category');
    setSearchParams(next, { replace: true });
  };

  const options = useMemo<LibraryFilterOption[]>(
    () => [
      { id: 'all', label: 'All', count: items.length },
      ...AGENT_CATEGORIES.filter(cat => (grouped.get(cat.id)?.length ?? 0) > 0).map(cat => ({
        id: cat.id,
        label: cat.label,
        count: grouped.get(cat.id)?.length ?? 0,
      })),
    ],
    [grouped, items.length],
  );

  const filtered = useMemo(() => {
    if (!activeId) return items;
    const inCategory = new Set(grouped.get(activeId)?.map(item => item.id) ?? []);
    return items.filter(item => inCategory.has(item.id));
  }, [items, activeId, grouped]);

  return { filtered, activeId, setActive, options };
}
