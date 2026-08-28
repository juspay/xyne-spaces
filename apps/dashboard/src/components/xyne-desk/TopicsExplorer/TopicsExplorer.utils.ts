import { parseAssigneeFilter, UNASSIGNED_FILTER_VALUE } from '../../../zero/queries';
import type { TicketFilters } from '../../Tickets/TicketFilters/types';

// The rollup runs client-side over synced rows, so the window stays short
// enough that one desk's tickets fit in the browser.
export const MAX_RANGE_DAYS = 30;
export const MAX_DEPTH = 4;
export const MS_PER_DAY = 86_400_000;
/** Key used when a ticket has no value for a dimension. */
const NONE_KEY = '__none__';

/** Ticket fields the rollup reads. Structurally assignable from a synced Zero row. */
export interface TopicsTicket {
  createdAt: number;
  conversationId: string;
  userGroupId?: string | null;
  priority: string;
  stageName: string;
  assignedTo?: string | null;
  aiCategory?: string | null;
}

/**
 * `assignedTo` is stored either bare or prefixed (`user:`/`group:`/`userGroup:`),
 * which is why the ticket-list filter expands a bare id back into every form.
 * Grouping has to collapse the same way, or one person splits across two buckets
 * and neither drills through correctly.
 */
const assigneeKey = (assignedTo: string | null | undefined): string => {
  if (!assignedTo) return UNASSIGNED_FILTER_VALUE;
  const bare = assignedTo.replace(/^(?:user|userGroup|group):/, '');
  return bare || UNASSIGNED_FILTER_VALUE;
};

export interface DimensionContext {
  /** Resolves assignee ids to display names; raw ids are meaningless as labels. */
  userName: (id: string) => string;
}

export interface Dimension {
  label: string;
  values: (ticket: TopicsTicket) => string[];
  format?: (key: string, ctx: DimensionContext) => string;
  /** URL value for the "no value" bucket. `null` means the ticket list cannot express it. */
  emptyParam?: string | null;
  /** Display name of the "no value" bucket. Absent on dimensions that never produce one. */
  emptyLabel?: string;
  /** True when a ticket can land in more than one bucket, so groups overlap. */
  multi?: boolean;
  /** Search-param understood by `readFiltersFromUrl`; absent means undrillable. */
  param?: string;
}

export interface ConversationTag {
  category: string;
  tag: string;
}
export type ConversationTagMap = ReadonlyMap<string, readonly ConversationTag[]>;

export interface TopicNode {
  key: string;
  label: string;
  tickets: TopicsTicket[];
}
export interface TrendPoint {
  day: string;
  count: number;
}

export interface Swatch {
  fill: string;
  /** Paired at authoring time; every combination clears WCAG AA (4.5:1). */
  ink: string;
}

// Shared by a group's tile and its trend row so the two panels read as one view.
const PALETTE: readonly Swatch[] = [
  { fill: '#4C1D95', ink: '#FFFFFF' },
  { fill: '#5B21B6', ink: '#FFFFFF' },
  { fill: '#6D28D9', ink: '#FFFFFF' },
  { fill: '#7C3AED', ink: '#FFFFFF' },
  { fill: '#9333EA', ink: '#FFFFFF' },
  { fill: '#A78BFA', ink: '#1F1147' },
  { fill: '#C4B5FD', ink: '#1F1147' },
  { fill: '#DDD6FE', ink: '#1F1147' },
];

export const swatchFor = (index: number): Swatch => PALETTE[index % PALETTE.length] as Swatch;

const GRID_COLUMNS = 8;
const GRID_ROWS = 6;
/** Half-gap between adjacent boxes, in px. */
const GUTTER = 3;

/** Cell coords on the GRID_COLUMNS x GRID_ROWS grid. */
export interface BoxShape {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Layout per box count, indexed by count: `x,y,w,h` boxes separated by spaces,
 * in rank order. Every template tiles all 48 cells, and no box is under 2 rows
 * tall, which is what label + count + bar needs.
 */
const SPECS: readonly string[] = [
  '',
  '0,0,8,6',
  '0,0,4,6 4,0,4,6',
  '0,0,4,6 4,0,4,3 4,3,4,3',
  '0,0,5,4 5,0,3,4 0,4,5,2 5,4,3,2',
  '0,0,4,3 4,0,4,3 0,3,3,3 3,3,3,3 6,3,2,3',
  '0,0,4,3 4,0,4,3 0,3,2,3 2,3,2,3 4,3,2,3 6,3,2,3',
  '0,0,3,3 3,0,3,3 6,0,2,3 0,3,2,3 2,3,2,3 4,3,2,3 6,3,2,3',
  '0,0,4,2 4,0,4,2 0,2,3,2 3,2,3,2 0,4,3,2 3,4,3,2 6,2,2,2 6,4,2,2',
];

const LAYOUT_TEMPLATES: BoxShape[][] = SPECS.map(spec =>
  spec
    .split(' ')
    .filter(Boolean)
    .map(box => {
      const [x, y, w, h] = box.split(',').map(Number) as [number, number, number, number];
      return { x, y, w, h };
    }),
);

// Capped by the palette too, so a page never runs past the ramp and gives two
// groups the same shade.
export const MAX_BOXES = Math.min(LAYOUT_TEMPLATES.length - 1, PALETTE.length);

export const templateFor = (count: number): BoxShape[] =>
  LAYOUT_TEMPLATES[Math.min(Math.max(count, 1), MAX_BOXES)] as BoxShape[];

/** CSS position/size for a shape, as percentages of the panel. */
export const shapeStyle = (
  shape: BoxShape,
): { left: string; top: string; width: string; height: string } => ({
  left: `calc(${(shape.x / GRID_COLUMNS) * 100}% + ${GUTTER}px)`,
  top: `calc(${(shape.y / GRID_ROWS) * 100}% + ${GUTTER}px)`,
  width: `calc(${(shape.w / GRID_COLUMNS) * 100}% - ${GUTTER * 2}px)`,
  height: `calc(${(shape.h / GRID_ROWS) * 100}% - ${GUTTER * 2}px)`,
});

const one = (v: string | null | undefined): string[] => [
  v === null || v === undefined || v === '' ? NONE_KEY : v,
];

// `emptyParam` is always null: the ticket list has no "has no value" filter for
// these columns, so a drill-through reports the level as dropped instead.
const single = (
  label: string,
  read: (ticket: TopicsTicket) => string | null | undefined,
  noneLabel: string,
  param?: string,
): Dimension => ({
  label,
  values: ticket => one(read(ticket)),
  format: key => (key === NONE_KEY ? noneLabel : key),
  ...(param ? { param } : {}),
  emptyParam: null,
  emptyLabel: noneLabel,
});

// All four map to a filter the ticket list already applies, so a tile opens the
// set it counted. Every other grouping is a tag category configured in Desk
// Settings, added by `buildDimensions` — no category is ever named here.
const DIMENSION_DEFS = {
  priority: single('Priority', t => t.priority, 'No priority', 'priority'),
  aiCategory: single('AI Category', t => t.aiCategory, 'Unclassified', 'aiCategory'),
  stageName: single('Stage', t => t.stageName, 'No stage', 'stages'),
  assignedTo: {
    label: 'Assignee',
    values: (t): string[] => [assigneeKey(t.assignedTo)],
    format: (key, ctx): string =>
      key === UNASSIGNED_FILTER_VALUE ? 'Unassigned' : ctx.userName(key),
    // No `emptyParam`: the unassigned bucket uses the sentinel the ticket list
    // understands, so this dimension never yields NONE_KEY.
    param: 'assignee',
  },
} satisfies Record<string, Dimension>;

export type StaticDimensionKey = keyof typeof DIMENSION_DEFS;

// The category suffix only exists at runtime, so the key type stays open.
export const AI_TAG_DIMENSION_PREFIX = 'aiTag:';
export type AiTagDimensionKey = `${typeof AI_TAG_DIMENSION_PREFIX}${string}`;
export type DimensionKey = StaticDimensionKey | AiTagDimensionKey;
export type DimensionMap = ReadonlyMap<DimensionKey, Dimension>;

// Re-typed as a uniform record: `satisfies` alone keeps each entry's literal
// shape, dropping the optional fields at the call site.
const DIMENSIONS: Record<StaticDimensionKey, Dimension> = DIMENSION_DEFS;
const STATIC_DIMENSION_KEYS = Object.keys(DIMENSIONS) as StaticDimensionKey[];

/** Placeholder for a key that no longer resolves, e.g. a tag category the range dropped. */
const MISSING_DIMENSION: Dimension = {
  label: 'Unavailable',
  values: () => [NONE_KEY],
  emptyParam: null,
};

export const dimensionFor = (dimensions: DimensionMap, key: DimensionKey | undefined): Dimension =>
  key ? (dimensions.get(key) ?? MISSING_DIMENSION) : MISSING_DIMENSION;

/** `sentiment` / `customer_intent` → `Sentiment` / `Customer Intent`. */
const titleise = (raw: string): string =>
  raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Static dimensions plus one per configured tag category. `tagCategories` is the
 * desk's own config, not the categories present in `tagsByConversation`: reading
 * the sample would drop a category the range happens not to cover, so the
 * "Group by" list would shift with the date range and lose a selection.
 */
export const buildDimensions = (
  tagsByConversation: ConversationTagMap,
  tagCategories: readonly string[],
): DimensionMap => {
  const map = new Map<DimensionKey, Dimension>(
    STATIC_DIMENSION_KEYS.map(key => [key, DIMENSIONS[key]] as const),
  );

  const categories = [...new Set(tagCategories.filter(Boolean))];
  for (const category of categories.sort((a, b) => a.localeCompare(b))) {
    const prefix = `${category}:`;
    map.set(`${AI_TAG_DIMENSION_PREFIX}${category}`, {
      // Prefixed: a desk can name a category "priority", which would otherwise
      // be indistinguishable from the ticket's own Priority grouping.
      label: `AI Tag · ${titleise(category)}`,
      values: ticket => {
        const keys = (tagsByConversation.get(ticket.conversationId) ?? [])
          .filter(t => t.category === category && !!t.tag)
          .map(t => `${prefix}${t.tag}`);
        return keys.length > 0 ? [...new Set(keys)] : [NONE_KEY];
      },
      // "in this range": the tag fetch is bounded by the panel's date window, so
      // a ticket tagged outside it lands here rather than in its tag's box.
      format: key =>
        key === NONE_KEY
          ? 'No tags in this range'
          : key.startsWith(prefix)
            ? key.slice(prefix.length)
            : key,
      multi: true,
      param: 'generatedTags',
      emptyParam: null,
      emptyLabel: 'No tags in this range',
    });
  }

  return map;
};

export const labelFor = (dim: Dimension, key: string, ctx: DimensionContext): string =>
  dim.format?.(key, ctx) ?? key;

export interface DrillLevel {
  dim: Dimension;
  key: string;
}

export interface DrillPlan {
  assignments: { param: string; value: string }[];
  /** Levels the ticket list has no filter for. */
  dropped: string[];
  /**
   * Names of the "no value" boxes the list cannot express — it can filter
   * `aiCategory=Refund` but not "aiCategory is empty". Only that box is blocked;
   * its siblings open normally, which is why it is not `dropped`.
   */
  emptyBuckets: string[];
  /**
   * Levels sharing a param with an earlier level at a different value. The list
   * ORs repeated params, so emitting both opens a strictly wider set than the
   * tile counted — nested AI-tag levels all share `generatedTags`.
   */
  conflicting: string[];
}

/**
 * A drill path as ticket-list search params. Every level must be expressible for
 * the opened list to equal the tile; the three failure lists are the ways that
 * fails, and the caller stays put on any of them.
 */
export const planDrill = (levels: readonly DrillLevel[]): DrillPlan => {
  const assignments: { param: string; value: string }[] = [];
  const dropped: string[] = [];
  const emptyBuckets: string[] = [];
  const conflicting: string[] = [];
  const claimed = new Map<string, string>();

  for (const { dim, key } of levels) {
    if (!dim.param) {
      dropped.push(dim.label);
      continue;
    }
    const value = key === NONE_KEY ? dim.emptyParam : key;
    if (value === null || value === undefined) {
      emptyBuckets.push(dim.emptyLabel ?? dim.label);
      continue;
    }
    const existing = claimed.get(dim.param);
    if (existing !== undefined) {
      if (existing !== value) conflicting.push(dim.label);
      continue;
    }
    claimed.set(dim.param, value);
    assignments.push({ param: dim.param, value });
  }

  return { assignments, dropped, emptyBuckets, conflicting };
};

/** Dimensions worth offering: a column where every ticket shares one value splits nothing. */
export const usefulDimensions = (
  tickets: readonly TopicsTicket[],
  dimensions: DimensionMap,
): DimensionKey[] => {
  const keys = [...dimensions.keys()];
  if (tickets.length === 0) return keys;
  return keys.filter(key => {
    // Always offered: grouping by a tag nothing carries honestly shows one
    // "not tagged" box, where hiding the option makes it look missing.
    if (key.startsWith(AI_TAG_DIMENSION_PREFIX)) return true;
    const seen = new Set<string>();
    for (const ticket of tickets) {
      for (const value of dimensionFor(dimensions, key).values(ticket)) {
        seen.add(value);
        if (seen.size > 1) return true;
      }
    }
    return false;
  });
};

/**
 * Desk's own ticket filters over the synced rows. Every filter but AI tags is a
 * column on the Zero row; AI tags live in `non_zero.tags`, so those arrive as a
 * conversation-id list the caller derives from the window's fetched tags.
 */
export const applyTicketFilters = (
  tickets: readonly TopicsTicket[],
  filters: TicketFilters,
  tagConversationIds: string[] | null,
): readonly TopicsTicket[] => {
  const aiCategory = filters.aiCategory?.length ? new Set(filters.aiCategory) : null;
  const priority = filters.priority?.length ? new Set<string>(filters.priority) : null;
  const stages = filters.stages?.length ? new Set(filters.stages) : null;
  const groups = filters.userGroups?.length ? new Set(filters.userGroups) : null;
  const conversations = tagConversationIds ? new Set(tagConversationIds) : null;

  // Through the same parser the ticket query uses, so the invert marker and the
  // "unassigned" sentinel mean here exactly what they mean there.
  const parsed = filters.assignee?.length ? parseAssigneeFilter(filters.assignee) : null;
  const assignee =
    parsed && (parsed.ids.length > 0 || parsed.includeUnassigned)
      ? { ...parsed, ids: new Set(parsed.ids) }
      : null;

  if (!aiCategory && !priority && !stages && !assignee && !groups && !conversations) return tickets;

  return tickets.filter(t => {
    if (aiCategory && !aiCategory.has(t.aiCategory ?? '')) return false;
    if (priority && !priority.has(t.priority)) return false;
    if (stages && !stages.has(t.stageName)) return false;
    if (assignee) {
      const key = assigneeKey(t.assignedTo);
      const hit =
        key === UNASSIGNED_FILTER_VALUE ? assignee.includeUnassigned : assignee.ids.has(key);
      // Inverting turns the selection into its complement, so a hit is a miss.
      if (hit === assignee.inverted) return false;
    }
    if (groups && !groups.has(t.userGroupId ?? '')) return false;
    if (conversations && !conversations.has(t.conversationId)) return false;
    return true;
  });
};

/** Group tickets by one dimension, ranked by volume. Every group is returned; paging trims. */
export const groupLevel = (
  tickets: readonly TopicsTicket[],
  dim: Dimension,
  ctx: DimensionContext,
): TopicNode[] => {
  const buckets = new Map<string, TopicsTicket[]>();
  for (const ticket of tickets) {
    for (const value of dim.values(ticket)) {
      const existing = buckets.get(value);
      if (existing) existing.push(ticket);
      else buckets.set(value, [ticket]);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, group]) => ({ key, label: labelFor(dim, key, ctx), tickets: group }));
};

export const ticketsForKey = (
  tickets: readonly TopicsTicket[],
  dim: Dimension,
  key: string,
): TopicsTicket[] => tickets.filter(t => dim.values(t).includes(key));

const toDayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

const trendStartMs = (days: number, endMs: number): number => {
  const cursor = new Date(endMs);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  return cursor.getTime();
};

/** Highest single-day count across every node — the shared Y domain. */
export const maxDailyCount = (nodes: TopicNode[], days: number, endMs: number): number => {
  const startMs = trendStartMs(days, endMs);
  const byDay = new Map<string, number>();
  let max = 1;
  for (const node of nodes) {
    byDay.clear();
    for (const ticket of node.tickets) {
      if (ticket.createdAt < startMs) continue;
      const key = toDayKey(ticket.createdAt);
      const next = (byDay.get(key) ?? 0) + 1;
      byDay.set(key, next);
      if (next > max) max = next;
    }
  }
  return max;
};

/** Daily counts per node, zero-filled so a quiet day reads as 0 rather than a gap. */
export const buildTrend = (nodes: TopicNode[], days: number, endMs: number): TrendPoint[][] => {
  // Walk calendar days, not fixed milliseconds — a DST day is 23 or 25 hours long.
  const startMs = trendStartMs(days, endMs);
  const cursor = new Date(startMs);
  const dayKeys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    dayKeys.push(toDayKey(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }

  return nodes.map(node => {
    const byDay = new Map<string, number>();
    for (const ticket of node.tickets) {
      if (ticket.createdAt < startMs) continue;
      const key = toDayKey(ticket.createdAt);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return dayKeys.map(day => ({ day, count: byDay.get(day) ?? 0 }));
  });
};
