import {
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subWeeks,
} from 'date-fns';

type DateGroupable = { id: string; startedAt: number };

type FixedDateGroupId = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month';

export interface DateGroup<T extends DateGroupable> {
  id: FixedDateGroupId | `month-${string}`;
  label: string;
  items: T[];
}

export type DateGroupedRow<T extends DateGroupable> =
  | {
      id: string;
      type: 'group';
      label: string;
    }
  | {
      id: string;
      type: 'item';
      item: T;
    };

const FIXED_GROUP_DEFINITIONS: ReadonlyArray<{ id: FixedDateGroupId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
];

/**
 * Groups a newest-first list without sorting or discarding entries.
 * More specific calendar periods take precedence over broader ones.
 *
 * @example
 * groupItemsByDate(items, now).map(group => group.label);
 * // ['Today', 'This week', 'June 2026']
 */
export function groupItemsByDate<T extends DateGroupable>(
  items: T[],
  now = new Date(),
): DateGroup<T>[] {
  const todayStart = startOfDay(now);
  const yesterday = subDays(todayStart, 1);
  const thisWeekStart = startOfWeek(todayStart, { weekStartsOn: 1 }).getTime();
  const lastWeekStart = subWeeks(thisWeekStart, 1).getTime();
  const thisMonthStart = startOfMonth(todayStart).getTime();

  const fixedGroups = new Map<FixedDateGroupId, T[]>(
    FIXED_GROUP_DEFINITIONS.map(({ id }) => [id, []]),
  );
  const monthGroups = new Map<string, T[]>();

  for (const item of items) {
    const startedAt = new Date(item.startedAt);
    let fixedGroupId: FixedDateGroupId | null = null;

    if (isSameDay(startedAt, todayStart)) {
      fixedGroupId = 'today';
    } else if (isSameDay(startedAt, yesterday)) {
      fixedGroupId = 'yesterday';
    } else if (item.startedAt >= thisWeekStart) {
      fixedGroupId = 'this-week';
    } else if (item.startedAt >= lastWeekStart) {
      fixedGroupId = 'last-week';
    } else if (item.startedAt >= thisMonthStart) {
      fixedGroupId = 'this-month';
    }

    if (fixedGroupId) {
      fixedGroups.get(fixedGroupId)?.push(item);
      continue;
    }

    const monthKey = format(startedAt, 'yyyy-MM');
    const monthItems = monthGroups.get(monthKey);
    if (monthItems) {
      monthItems.push(item);
    } else {
      monthGroups.set(monthKey, [item]);
    }
  }

  const groups: DateGroup<T>[] = FIXED_GROUP_DEFINITIONS.flatMap(({ id, label }) => {
    const groupedItems = fixedGroups.get(id) ?? [];
    return groupedItems.length > 0 ? [{ id, label, items: groupedItems }] : [];
  });

  for (const [monthKey, monthItems] of monthGroups) {
    groups.push({
      id: `month-${monthKey}`,
      label: format(new Date(monthItems[0]!.startedAt), 'MMMM yyyy'),
      items: monthItems,
    });
  }

  return groups;
}

/**
 * Interleaves each date heading with its item rows for a virtualized list.
 *
 * @example
 * buildDateGroupRows(groups).map(row => row.type);
 * // ['group', 'item', 'item', 'group', 'item']
 */
export function buildDateGroupRows<T extends DateGroupable>(
  groups: DateGroup<T>[],
): DateGroupedRow<T>[] {
  return groups.flatMap<DateGroupedRow<T>>(group => [
    {
      id: `group-${group.id}`,
      type: 'group',
      label: group.label,
    },
    ...group.items.map(
      (item): DateGroupedRow<T> => ({
        id: `item-${item.id}`,
        type: 'item',
        item,
      }),
    ),
  ]);
}

export function buildDateGroupedRowsFromItems<T extends DateGroupable>(
  items: T[],
  now = new Date(),
): DateGroupedRow<T>[] {
  return buildDateGroupRows(groupItemsByDate(items, now));
}

/**
 * Finds the closest item row at or after a visible index, falling back to the row before it.
 * Used to translate a virtualized row index (which includes interleaved group headers) back
 * into a real item, e.g. to resolve the corresponding index in an unfiltered source list.
 *
 * @example
 * findNearestVisibleItem(rows, 3); // T | undefined
 */
export function findNearestVisibleItem<T extends DateGroupable>(
  rows: DateGroupedRow<T>[],
  startIndex: number,
): T | undefined {
  const row =
    rows.slice(startIndex).find(candidate => candidate.type === 'item') ??
    rows
      .slice(0, startIndex)
      .reverse()
      .find(candidate => candidate.type === 'item');

  return row?.type === 'item' ? row.item : undefined;
}
