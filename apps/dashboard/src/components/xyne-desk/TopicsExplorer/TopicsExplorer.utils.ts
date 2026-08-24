import { UNASSIGNED_FILTER_VALUE } from '../../../zero/queries';
import { CHART_COLORS } from '../../QueryVisualizations/constants';
import type { TicketFilters } from '../../Tickets/TicketFilters/types';

export const TREND_DAYS = 30;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_DEPTH = 4;
export const MS_PER_DAY = 86_400_000;
/** Key used when a ticket has no value for a dimension. */
export const NONE_KEY = '__none__';
const ACCENT = '#8200DB';

/** Ticket fields the rollup reads. Structurally assignable from a synced Zero row. */
export interface TopicsTicket {
  id: string;
  createdAt: number;
  /** Needed to apply the AI-tag filter, which resolves to conversation ids. */
  conversationId: string;
  userGroupId?: string | null;
  priority: string;
  stageName: string;
  assignedTo?: string | null;
  aiCategory?: string | null;
  aiSubCategory?: string | null;
  aiPriority?: string | null;
  /** From `.related('tagMappings')`; `tagName` is denormalized on the row. */
  tagMappings?: readonly { tagName: string }[];
}

export interface DimensionContext {
  /** Resolves assignee ids to display names; raw ids are meaningless as labels. */
  userName: (id: string) => string;
}

export interface Dimension {
  label: string;
  /**
   * Group KEYS a ticket contributes — raw column values, never display text,
   * since these travel to the ticket list as filter params and must be what its
   * filters expect (a user id, not a name).
   */
  values: (ticket: TopicsTicket) => string[];
  /** Human-readable text for a key. Defaults to the key itself. */
  format?: (key: string, ctx: DimensionContext) => string;
  /**
   * URL value for the "no value" bucket. `null` means the ticket list cannot
   * express it, so a drill-through says so rather than emitting a value the list
   * would ignore or reject.
   */
  emptyParam?: string | null;
  /** True when a ticket can land in more than one bucket, so groups overlap. */
  multi?: boolean;
  /** Search-param understood by `readFiltersFromUrl`; absent means undrillable. */
  param?: string;
}

/** One LLM tag on a conversation, as returned by the tags-config API. */
export interface ConversationTag {
  category: string;
  tag: string;
}
/** LLM tags keyed by conversation id, so a ticket can look up its own. */
export type ConversationTagMap = ReadonlyMap<string, readonly ConversationTag[]>;

export interface TopicNode {
  key: string;
  label: string;
  tickets: TopicsTicket[];
}
export interface TrendSeries {
  key: string;
  label: string;
  points: { day: string; count: number }[];
}

/** One hue per group, shared by its tile and its trend row so the two panels match. */
export const PALETTE = CHART_COLORS.series;

const channelLuminance = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour. */
const relativeLuminance = (hex: string): number => {
  const n = parseInt(hex.replace('#', ''), 16);
  return (
    0.2126 * channelLuminance((n >> 16) & 255) +
    0.7152 * channelLuminance((n >> 8) & 255) +
    0.0722 * channelLuminance(n & 255)
  );
};

/**
 * Foreground that passes contrast on a swatch. White failed WCAG AA on 9 of the
 * 10 palette colours, so this is picked per swatch to stay above 4.5:1.
 */
export const readableOn = (background: string): string =>
  relativeLuminance(background) > 0.18 ? '#111111' : '#FFFFFF';

/** Hue by rank within the page. */
export const colourFor = (index: number): string => PALETTE[index % PALETTE.length] ?? ACCENT;

const GRID_COLUMNS = 8;
const GRID_ROWS = 6;
/** Half-gap between adjacent boxes, in px. */
const GUTTER = 3;

type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface BoxShape {
  /** Cell coords on the GRID_COLUMNS x GRID_ROWS grid. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional corner cut, which turns the rectangle into an L. */
  notch?: { corner: Corner; w: number; h: number };
}

/**
 * Layout per box count over the 8x6 grid, indexed by count. One string per
 * template, boxes separated by spaces: `x,y,w,h` or `x,y,w,h,corner,nw,nh` for
 * an L. Encoded rather than nested arrays purely because the formatter expands
 * those to one number per line, which buried 8 layouts in 50 lines.
 *
 * Every template tiles all 48 cells exactly — full coverage, no overlap — so the
 * panel is always filled. Areas step down with rank while the largest stays
 * within ~3x the smallest, and several use L-shapes rather than plain rectangles.
 */
const SPECS: readonly string[] = [
  '',
  '0,0,8,6',
  '0,0,5,6,tr,1,2 4,0,4,6,bl,1,4',
  '0,0,4,6,br,2,2 4,0,4,4 2,4,6,2',
  '0,0,5,4 5,0,3,4 0,4,5,2 5,4,3,2',
  '0,0,4,4,br,1,1 4,0,4,3 3,3,3,3 0,4,3,2 6,3,2,3',
  '0,0,4,3 4,0,4,3 0,3,2,3 2,3,2,3 4,3,2,3 6,3,2,3',
  '0,0,3,3 3,0,3,3 6,0,2,3 0,3,2,3 2,3,2,3 4,3,2,3 6,3,2,3',
  '0,0,4,3 4,0,4,3 0,3,2,2 2,3,2,2 4,3,2,2 6,3,2,2 0,5,4,1 4,5,4,1',
];

const LAYOUT_TEMPLATES: BoxShape[][] = SPECS.map(spec =>
  spec
    .split(' ')
    .filter(Boolean)
    .map(box => {
      const [x, y, w, h, corner, nw, nh] = box.split(',');
      const rect = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
      // A corner always ships with both notch dimensions.
      return corner
        ? { ...rect, notch: { corner: corner as Corner, w: Number(nw), h: Number(nh) } }
        : rect;
    }),
);

/** Largest page a template exists for. Pages never exceed this. */
export const MAX_BOXES = LAYOUT_TEMPLATES.length - 1;
const FALLBACK_TEMPLATE = LAYOUT_TEMPLATES[MAX_BOXES] as BoxShape[];

export const templateFor = (count: number): BoxShape[] =>
  LAYOUT_TEMPLATES[Math.min(Math.max(count, 1), MAX_BOXES)] ?? FALLBACK_TEMPLATE;

/** CSS position/size for a shape, as percentages of the panel. */
export const shapeStyle = (
  shape: BoxShape,
): { left: string; top: string; width: string; height: string; clipPath?: string } => {
  // Real geometry, not an `outline`: that needs hsl() around the token and would
  // steal the only property that can show a focus ring.
  const base = {
    left: `calc(${(shape.x / GRID_COLUMNS) * 100}% + ${GUTTER}px)`,
    top: `calc(${(shape.y / GRID_ROWS) * 100}% + ${GUTTER}px)`,
    width: `calc(${(shape.w / GRID_COLUMNS) * 100}% - ${GUTTER * 2}px)`,
    height: `calc(${(shape.h / GRID_ROWS) * 100}% - ${GUTTER * 2}px)`,
  };
  if (!shape.notch) return base;

  // Percentages within the box itself, so the cut lands on a cell boundary.
  const nx = (shape.notch.w / shape.w) * 100;
  const ny = (shape.notch.h / shape.h) * 100;
  return {
    ...base,
    clipPath: {
      tl: `polygon(${nx}% 0, 100% 0, 100% 100%, 0 100%, 0 ${ny}%, ${nx}% ${ny}%)`,
      tr: `polygon(0 0, ${100 - nx}% 0, ${100 - nx}% ${ny}%, 100% ${ny}%, 100% 100%, 0 100%)`,
      bl: `polygon(0 0, 100% 0, 100% 100%, ${nx}% 100%, ${nx}% ${100 - ny}%, 0 ${100 - ny}%)`,
      br: `polygon(0 0, 100% 0, 100% ${100 - ny}%, ${100 - nx}% ${100 - ny}%, ${100 - nx}% 100%, 0 100%)`,
    }[shape.notch.corner],
  };
};

const one = (v: string | null | undefined): string[] => [
  v === null || v === undefined || v === '' ? NONE_KEY : v,
];

/**
 * A single-valued Zero column. `emptyParam` is always null: the ticket list has
 * no "has no value" filter for these columns, so a drill-through reports the
 * level as dropped rather than emit a value the list ignores or rejects.
 */
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
});

/**
 * Groupable dimensions, in "Group by" option order. `values` yields raw keys and
 * `format` renders them — kept separate because keys travel to the ticket list as
 * filter params. Zero-backed columns only; LLM tag categories live in
 * `non_zero.tags`, which Zero does not mirror, so `buildDimensions` adds those.
 */
const DIMENSION_DEFS = {
  aiCategory: single('AI Category', t => t.aiCategory, 'Unclassified', 'aiCategory'),
  aiSubCategory: single('AI Sub-category', t => t.aiSubCategory, 'Unclassified'),
  tag: {
    label: 'Tag',
    // Multi-valued: a ticket with three tags counts under all three, so groups
    // deliberately sum to more than the parent.
    // Falls back to NONE_KEY when every mapping has a blank name: returning []
    // put the ticket in no bucket at all, so the groups silently summed to less
    // than the header total.
    values: (t): string[] => {
      const names = (t.tagMappings ?? []).map(m => m.tagName).filter(Boolean);
      return names.length > 0 ? names : [NONE_KEY];
    },
    format: (key): string => (key === NONE_KEY ? 'Untagged' : key),
    multi: true,
    // No `param`: SupportScreen parses `tags` but never applies it, so emitting
    // one would open an unfiltered list. Unset means "reported as dropped".
    emptyParam: null,
  },
  priority: single('Priority', t => t.priority, 'No priority', 'priority'),
  aiPriority: single('AI Priority', t => t.aiPriority, 'Not scored'),
  stageName: single('Stage', t => t.stageName, 'No stage', 'stages'),
  assignedTo: {
    label: 'Assignee',
    // Keys are user ids so the drill-through filters correctly; names are display only.
    values: (t): string[] => [t.assignedTo ? t.assignedTo : UNASSIGNED_FILTER_VALUE],
    format: (key, ctx): string =>
      key === UNASSIGNED_FILTER_VALUE ? 'Unassigned' : ctx.userName(key),
    // No `emptyParam`: this dimension never yields NONE_KEY — the unassigned
    // bucket already uses the sentinel the ticket list understands.
    param: 'assignee',
  },
} satisfies Record<string, Dimension>;

/** Zero-backed dimensions, whose keys are known at compile time. */
export type StaticDimensionKey = keyof typeof DIMENSION_DEFS;

/**
 * Prefix marking a data-driven LLM-tag dimension. The category suffix only
 * exists at runtime, so the key type stays open — but narrower than `string`,
 * so a typo cannot pass for a static key.
 */
export const AI_TAG_DIMENSION_PREFIX = 'aiTag:';
export type AiTagDimensionKey = `${typeof AI_TAG_DIMENSION_PREFIX}${string}`;
export type DimensionKey = StaticDimensionKey | AiTagDimensionKey;
/** Every offerable dimension for the current data, static and derived alike. */
export type DimensionMap = ReadonlyMap<DimensionKey, Dimension>;

// Re-typed as a uniform record: `satisfies` alone keeps each entry's literal
// shape, which drops the optional `multi` / `param` fields at the call site.
export const DIMENSIONS: Record<StaticDimensionKey, Dimension> = DIMENSION_DEFS;
const STATIC_DIMENSION_KEYS = Object.keys(DIMENSIONS) as StaticDimensionKey[];

/**
 * Placeholder for a key that no longer resolves — e.g. a tag category that
 * vanished when the range changed. Yields one empty bucket instead of throwing.
 */
const MISSING_DIMENSION: Dimension = {
  label: 'Unavailable',
  values: () => [NONE_KEY],
  emptyParam: null,
};

/** Safe lookup: callers never have to assert a runtime key exists. */
export const dimensionFor = (dimensions: DimensionMap, key: DimensionKey | undefined): Dimension =>
  key ? (dimensions.get(key) ?? MISSING_DIMENSION) : MISSING_DIMENSION;

/** `sentiment` / `customer_intent` → `Sentiment` / `Customer Intent`. */
const titleise = (raw: string): string =>
  raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const aiTagDimensionKey = (category: string): AiTagDimensionKey =>
  `${AI_TAG_DIMENSION_PREFIX}${category}`;

/**
 * One dimension per LLM tag category in the fetched data. Keys are the
 * `"category:tag"` composite the ticket list's `generatedTags` filter expects,
 * so a drill-through carries a value the list can read back.
 */
export const buildDimensions = (tagsByConversation: ConversationTagMap): DimensionMap => {
  const categories = new Set<string>();
  for (const tags of tagsByConversation.values()) {
    for (const { category } of tags) if (category) categories.add(category);
  }

  const map = new Map<DimensionKey, Dimension>(
    STATIC_DIMENSION_KEYS.map(key => [key, DIMENSIONS[key]] as const),
  );

  for (const category of [...categories].sort((a, b) => a.localeCompare(b))) {
    const prefix = `${category}:`;
    map.set(aiTagDimensionKey(category), {
      // "AI Tag · " keeps these distinct from BOTH the user-applied "Tag" dimension
      // and the static AI columns: a category named "priority" would otherwise render
      // "AI: Priority" beside the "AI Priority" column — same value space, different
      // numbers, indistinguishable.
      label: `AI Tag · ${titleise(category)}`,
      values: ticket => {
        const keys = (tagsByConversation.get(ticket.conversationId) ?? [])
          .filter(t => t.category === category && !!t.tag)
          .map(t => `${prefix}${t.tag}`);
        return keys.length > 0 ? [...new Set(keys)] : [NONE_KEY];
      },
      format: key =>
        key === NONE_KEY ? 'Not tagged' : key.startsWith(prefix) ? key.slice(prefix.length) : key,
      // A conversation can carry several tags in one category.
      multi: true,
      param: 'generatedTags',
      // The ticket list can filter for a tag, but not for the absence of one.
      emptyParam: null,
    });
  }

  return map;
};

/** Display text for a group key. */
export const labelFor = (dim: Dimension, key: string, ctx: DimensionContext): string =>
  dim.format?.(key, ctx) ?? key;

/** Distinct values for a Zero-backed dimension, most common first — powers the filter menus. */
export const distinctValues = (
  tickets: readonly TopicsTicket[],
  key: StaticDimensionKey,
): { value: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    for (const value of DIMENSIONS[key].values(ticket))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

/** Dimensions worth offering: a column where every ticket shares one value splits nothing. */
export const usefulDimensions = (
  tickets: readonly TopicsTicket[],
  dimensions: DimensionMap,
): DimensionKey[] => {
  const keys = [...dimensions.keys()];
  if (tickets.length === 0) return keys;
  return keys.filter(key => {
    // Always offered: hiding a tag dimension when nothing is tagged makes the
    // option look missing, where grouping by it honestly shows one "Untagged" box.
    if (key === 'tag' || key.startsWith(AI_TAG_DIMENSION_PREFIX)) return true;
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
 * Desk's own ticket filters, applied to the synced rows. Every filter but AI tags
 * is a column on the Zero row; AI tags live in `non_zero.tags`, so those arrive
 * pre-resolved server-side as a conversation-id whitelist.
 */
export const applyTicketFilters = (
  tickets: readonly TopicsTicket[],
  filters: TicketFilters,
  tagConversationIds: string[] | null,
): readonly TopicsTicket[] => {
  const aiCategory = filters.aiCategory?.length ? new Set(filters.aiCategory) : null;
  const priority = filters.priority?.length ? new Set<string>(filters.priority) : null;
  const stages = filters.stages?.length ? new Set(filters.stages) : null;
  const assignee = filters.assignee?.length ? new Set(filters.assignee) : null;
  const groups = filters.userGroups?.length ? new Set(filters.userGroups) : null;
  const conversations = tagConversationIds ? new Set(tagConversationIds) : null;

  if (!aiCategory && !priority && !stages && !assignee && !groups && !conversations) return tickets;

  return tickets.filter(t => {
    if (aiCategory && !aiCategory.has(t.aiCategory ?? '')) return false;
    if (priority && !priority.has(t.priority)) return false;
    if (stages && !stages.has(t.stageName)) return false;
    if (assignee && !assignee.has(t.assignedTo ?? UNASSIGNED_FILTER_VALUE)) return false;
    if (groups && !groups.has(t.userGroupId ?? '')) return false;
    if (conversations && !conversations.has(t.conversationId)) return false;
    return true;
  });
};

/**
 * Group tickets by one dimension, ranked by volume. Returns every group —
 * trimming happens at display time by paging, so a desk with hundreds of
 * categories stays explorable rather than collapsing its tail into a dead bucket.
 */
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

/** Tickets belonging to one group of this level. */
export const ticketsForKey = (
  tickets: readonly TopicsTicket[],
  dim: Dimension,
  key: string,
): TopicsTicket[] => tickets.filter(t => dim.values(t).includes(key));

const toDayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

/** Daily counts per node, zero-filled so a quiet day reads as 0 rather than a gap. */
export const buildTrend = (nodes: TopicNode[], days: number, endMs: number): TrendSeries[] => {
  // Walk calendar days, not fixed milliseconds — a DST day is 23 or 25 hours long.
  const cursor = new Date(endMs);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  const startMs = cursor.getTime();
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
    return {
      key: node.key,
      label: node.label,
      points: dayKeys.map(day => ({ day, count: byDay.get(day) ?? 0 })),
    };
  });
};
