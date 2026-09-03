/**
 * The single definition of every search filter.
 *
 * A filter has to show up in a lot of places: the results URL, the palette's typed syntax,
 * the Vespa request, the bar chips, the search-box tokens, the Filters modal, the
 * "how many are set" badge. Before this registry each of those was a separate hand-written
 * list, and they drifted — a filter added to one and forgotten in another would silently
 * fail to persist, which is exactly how the date filter ended up half-wired.
 *
 * Adding a filter now means adding ONE entry here. Everything below is derived from it.
 *
 * Each entry owns its slice of `SearchResultsFilters` through closures rather than a single
 * typed key, so a filter spanning several fields (dates own `dateRange`/`after`/`before`)
 * is still one entry.
 */
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { ChipType } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import {
  DEFAULT_SEARCH_FILTERS,
  resolveDateKeyword,
  type ChipPrefix,
  type ResolvableDateKeyword,
  type SearchResultsFilters,
  type StructuredSearchFilters,
} from './filterModel';

/** A chip as the search hook wants it. */
export type ResultsMention = {
  id: string;
  type: ChipType;
  prefix?: ChipPrefix;
  name?: string;
};

/** Turns ids into display names. Supplied by whichever surface is rendering. */
export interface FilterResolvers {
  userName: (id: string) => string | undefined;
  channelName: (id: string) => string | undefined;
  boardName?: (id: string) => string | undefined;
}

/**
 * The leading glyph a token carries. Users get their avatar (resolved from the id by the
 * rendering surface); everything else gets a kind-specific icon, matching the design's
 * pill anatomy.
 */
export type TokenIcon =
  | { kind: 'user'; userId: string }
  // Carries the id so the renderer can pick hash / lock / person from the channel's
  // visibility and scope, the way the palette's chips do.
  | { kind: 'channel'; channelId: string }
  | { kind: 'priority'; value: string }
  | { kind: 'date' }
  | { kind: 'board' }
  | { kind: 'value' };

/** One removable thing in the search box / bar. */
export interface FilterToken {
  key: string;
  /**
   * The `from:` / `in:` part, rendered before the glyph — so a token reads
   * `in: 🔒 vespa-search`, matching the palette's chip anatomy. Absent for bare mention
   * tokens, where the `@`/`#` sigil is part of the label itself.
   */
  prefix?: string;
  /** The value, rendered after the glyph. */
  label: string;
  patch: Partial<SearchResultsFilters>;
  icon?: TokenIcon;
}

export type DocType = SearchResultsFilters['docType'];

export interface FilterEntry {
  id: string;
  /** Field label used by the Filters modal and the applied chips. */
  label: string;
  /** URL params this filter owns. Nothing else may write them. */
  params: readonly string[];
  /** Types that can express this filter; others hide and clear it. */
  appliesTo?: (docType: DocType) => boolean;
  /** Counted by the Filters badge — false for things with their own bar control. */
  hidden?: boolean;
  isActive: (f: SearchResultsFilters) => boolean;
  /** Value that turns this filter off. */
  cleared: Partial<SearchResultsFilters>;
  /** URL → filters. `typed` carries filter syntax lifted out of the query text. */
  read: (params: URLSearchParams, typed: TypedFilters) => Partial<SearchResultsFilters>;
  /** filters → URL. */
  write: (f: SearchResultsFilters, params: URLSearchParams) => void;
  /** filters → chips for the search hook. */
  chips?: (f: SearchResultsFilters, resolve: FilterResolvers) => ResultsMention[];
  /** filters → the typed syntax the palette speaks. */
  queryText?: (f: SearchResultsFilters) => string;
  /** filters → the structured fields the Vespa request takes. */
  searchFilters?: (f: SearchResultsFilters) => Partial<StructuredSearchFilters>;
  /** filters → removable tokens in the search box. */
  tokens?: (f: SearchResultsFilters, resolve: FilterResolvers) => FilterToken[];
  /** chips → filters: the inverse of `chips`, for the palette's hand-off to the page. */
  fromChips?: (mentions: ResultsMention[]) => Partial<SearchResultsFilters>;
  /** How the Filters modal renders this entry. Absent = no control of its own. */
  control?: FilterControl;
  /** Value for the modal control, and the patch that writes it back. */
  getValue?: (f: SearchResultsFilters) => string[] | string | boolean;
  setValue?: (next: string[] | string | boolean) => Partial<SearchResultsFilters>;
}

/** The widget kinds the Filters modal knows how to render. */
export type FilterControl =
  | { kind: 'people'; placeholder: string }
  // `excludeDMs` for filters a DM can't satisfy — a DM is never `#`-referenced in a
  // message, so it has no business in the channel-mentions picker.
  | { kind: 'channels'; placeholder: string; excludeDMs?: boolean }
  // People and channels in one picker — see the `mentions` entry.
  | { kind: 'mentions'; placeholder: string }
  | { kind: 'boards' }
  | { kind: 'enumMulti'; options: ReadonlyArray<{ value: string; label: string }> }
  | {
      kind: 'enumSingle';
      options: ReadonlyArray<{ value: string; label: string }>;
      anyLabel: string;
    }
  | { kind: 'text'; placeholder: string }
  | { kind: 'date' }
  | { kind: 'toggle' };

/** The shape `parseSearchFilters` returns — filter syntax found in free text. */
export interface TypedFilters {
  status?: string | undefined;
  board?: string | undefined;
  tags?: string | undefined;
  before?: string | undefined;
  after?: string | undefined;
  on?: string | undefined;
  range?: string | undefined;
}

/** The backend query-param names a text-list filter can set. */
type SearchFilterKey = 'status' | 'board' | 'tags';

/** Filter values travel as plain strings (URL params, typed syntax), so options are too. */
export type FilterOption = { value: string; label: string };

export const STATUS_OPTIONS: FilterOption[] = [
  { value: TicketStatusV2.TODO, label: 'To do' },
  { value: TicketStatusV2.STARTED, label: 'Started' },
  { value: TicketStatusV2.PAUSED, label: 'Paused' },
  { value: TicketStatusV2.COMPLETED, label: 'Completed' },
  { value: TicketStatusV2.CANCELLED, label: 'Cancelled' },
];

export const PRIORITY_OPTIONS: FilterOption[] = [
  { value: TicketPriority.LOW, label: 'Low' },
  { value: TicketPriority.MEDIUM, label: 'Medium' },
  { value: TicketPriority.HIGH, label: 'High' },
  { value: TicketPriority.CRITICAL, label: 'Critical' },
];

/**
 * Slack's preset list. Typed as `ResolvableDateKeyword` so every preset is guaranteed to
 * expand to concrete dates — a preset the resolver doesn't know is a compile error here,
 * not a filter that quietly stops working.
 */
export const DATE_RANGE_OPTIONS: ReadonlyArray<{
  value: ResolvableDateKeyword | '';
  label: string;
}> = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last 7 days', label: 'Last 7 days' },
  { value: 'last 30 days', label: 'Last 30 days' },
  { value: 'last three months', label: 'Last three months' },
  { value: 'last 12 months', label: 'Last 12 months' },
  { value: 'last three years', label: 'Last three years' },
];

const csv = (value: string | null | undefined): string[] =>
  value
    ? value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    : [];

const setOrDelete = (params: URLSearchParams, key: string, value: string): void => {
  if (value) params.set(key, value);
  else params.delete(key);
};

const isTicketType = (d: DocType): boolean => d === 'tickets' || d === 'all';
const isMessageType = (d: DocType): boolean => d === 'messages' || d === 'all';
const isTicketOrMessageType = (d: DocType): boolean => isTicketType(d) || isMessageType(d);
const isLocalType = (d: DocType): boolean => d === 'channels' || d === 'people';
const notLocal = (d: DocType): boolean => !isLocalType(d);

/**
 * A filter that is a list of ids shown as chips — from/in/with/assignee and the bare
 * @user / #channel mentions. They differ only in param name, chip prefix and how an id
 * turns into a name, so they share one factory.
 */
function chipListEntry(opts: {
  id: string;
  label: string;
  param: string;
  field:
    | 'fromUserIds'
    | 'fromEmails'
    | 'toEmails'
    | 'inChannelIds'
    | 'withUserIds'
    | 'assigneeIds'
    | 'mentionUserIds'
    | 'mentionChannelIds';
  mentionType: ChipType;
  prefix?: ResultsMention['prefix'];
  /**
   * Syntax shown in the search box, e.g. `from:name`. No `@`/`#` sigil when the token also
   * draws a glyph (avatar, hash) — the glyph already says which kind of value it is, and
   * both together read as `# in:#general`. Bare mention tokens keep their sigil: it's the
   * whole prefix, and it's what distinguishes "mentions X" from "from X".
   */
  tokenPrefix: string;
  resolveWith: 'user' | 'channel' | 'raw';
  /** Kept on the value even when there's a named prefix — see the mentions entries. */
  valueSigil?: string;
  /** Identifies this entry's chips among the palette's selected mentions. */
  matches: (m: ResultsMention) => boolean;
  control?: FilterControl;
  appliesTo?: (docType: DocType) => boolean;
  hidden?: boolean;
}): FilterEntry {
  const named = opts.tokenPrefix.endsWith(':');
  const nameFor = (id: string, resolve: FilterResolvers): string => {
    if (opts.resolveWith === 'user') return resolve.userName(id) ?? id;
    if (opts.resolveWith === 'channel') return resolve.channelName(id) ?? id;
    return id;
  };
  return {
    id: opts.id,
    label: opts.label,
    params: [opts.param],
    ...(opts.appliesTo ? { appliesTo: opts.appliesTo } : {}),
    ...(opts.hidden === undefined ? {} : { hidden: opts.hidden }),
    isActive: f => f[opts.field].length > 0,
    cleared: { [opts.field]: [] } as Partial<SearchResultsFilters>,
    read: params => ({ [opts.field]: csv(params.get(opts.param)) }),
    write: (f, params) => setOrDelete(params, opts.param, f[opts.field].join(',')),
    chips: (f, resolve) =>
      f[opts.field].map(id => {
        const name = nameFor(id, resolve);
        // exactOptionalPropertyTypes forbids an explicit undefined, so build conditionally.
        return {
          id,
          type: opts.mentionType,
          ...(opts.prefix ? { prefix: opts.prefix } : {}),
          ...(opts.resolveWith === 'raw' ? {} : { name }),
        };
      }),
    tokens: (f, resolve) =>
      f[opts.field].map(id => ({
        key: `${opts.id}-${id}`,
        // A named prefix (`in:`) is its own segment so the glyph can sit between it and
        // the value; a bare sigil (`@`, `#`) is the label's first character instead.
        ...(named ? { prefix: opts.tokenPrefix } : {}),
        label: named
          ? `${opts.valueSigil ?? ''}${nameFor(id, resolve)}`
          : `${opts.tokenPrefix}${nameFor(id, resolve)}`,
        patch: {
          [opts.field]: f[opts.field].filter(v => v !== id),
        } as Partial<SearchResultsFilters>,
        icon:
          opts.resolveWith === 'user'
            ? ({ kind: 'user', userId: id } as const)
            : opts.resolveWith === 'channel'
              ? ({ kind: 'channel', channelId: id } as const)
              : ({ kind: 'value' } as const),
      })),
    fromChips: mentions =>
      ({
        [opts.field]: mentions.filter(opts.matches).map(m => m.id),
      }) as Partial<SearchResultsFilters>,
    ...(opts.control ? { control: opts.control } : {}),
    getValue: f => f[opts.field],
    setValue: next => ({ [opts.field]: next }) as Partial<SearchResultsFilters>,
  };
}

/**
 * A filter that is a list of values carried as typed syntax rather than chips —
 * status/board/tags. The backend reads them from the same fields the query text produces.
 */
function textListEntry(opts: {
  id: string;
  label: string;
  param: string;
  field: 'statuses' | 'boardIds' | 'tags';
  syntax: string;
  typedKey: 'status' | 'board' | 'tags';
  searchKey: SearchFilterKey;
  tokenIcon?: TokenIcon;
  appliesTo?: (docType: DocType) => boolean;
  /** Set when the palette picks this filter's values, so it rides as a chip, not syntax. */
  chip?: {
    type: ChipType;
    prefix: ChipPrefix;
    label: (value: string, resolve: FilterResolvers) => string;
  };
  /** Omitted for typed-only filters, which get no row in the Filters modal. */
  control?: FilterControl;
}): FilterEntry {
  return {
    id: opts.id,
    label: opts.label,
    params: [opts.param],
    // Ticket filters are the common case; tags span tickets and messages.
    appliesTo: opts.appliesTo ?? isTicketType,
    isActive: f => f[opts.field].length > 0,
    cleared: { [opts.field]: [] } as Partial<SearchResultsFilters>,
    // Params win; syntax typed into the query fills the gap, so `status:todo` still
    // lights up its control instead of only reaching the backend.
    read: (params, typed) => ({
      [opts.field]: params.get(opts.param)
        ? csv(params.get(opts.param))
        : csv(typed[opts.typedKey]),
    }),
    write: (f, params) => setOrDelete(params, opts.param, f[opts.field].join(',')),
    queryText: f => (f[opts.field].length > 0 ? `${opts.syntax}${f[opts.field].join(',')}` : ''),
    searchFilters: f =>
      f[opts.field].length > 0 ? { [opts.searchKey]: f[opts.field].join(',') } : {},
    tokens: (f, resolve) =>
      f[opts.field].length === 0
        ? []
        : [
            {
              key: opts.id,
              // Chip-borne filters carry ids the backend matches on (a boardId, a status
              // enum), so the token reads through the same label resolver the chip uses.
              prefix: opts.syntax,
              label: f[opts.field].map(v => opts.chip?.label(v, resolve) ?? v).join(','),
              patch: { [opts.field]: [] } as Partial<SearchResultsFilters>,
              icon: opts.tokenIcon ?? { kind: 'value' },
            },
          ],
    ...(opts.control ? { control: opts.control } : {}),
    getValue: f => f[opts.field],
    setValue: next => ({ [opts.field]: next }) as Partial<SearchResultsFilters>,
    // A text-list filter the palette picks values for (currently just board) travels as a
    // chip instead of syntax, so it needs the inverse mapping too.
    //
    // A filter may travel as a chip OR as text, never both: emitting both seeds the palette
    // with a chip *and* `board:<id>` text, which re-parses into a second, duplicate filter.
    ...(opts.chip
      ? ((): Partial<FilterEntry> => {
          const chip = opts.chip;
          const field = opts.field;
          return {
            queryText: (): string => '',
            chips: (f: SearchResultsFilters, resolve: FilterResolvers): ResultsMention[] =>
              f[field].map(id => ({
                id,
                type: chip.type,
                prefix: chip.prefix,
                name: chip.label(id, resolve),
              })),
            fromChips: (mentions: ResultsMention[]): Partial<SearchResultsFilters> => ({
              [field]: mentions.filter(m => m.type === chip.type).map(m => m.id),
            }),
          };
        })()
      : {}),
  };
}

/** A boolean scope toggle carried as an explicit 0/1 param. */
function toggleEntry(opts: {
  id: string;
  label: string;
  param: string;
  field: 'onlyMyChannels' | 'includeBotMessages';
  /** Written only when it differs from this. */
  defaultValue: boolean;
  explicitOff?: boolean;
  appliesTo?: (docType: DocType) => boolean;
}): FilterEntry {
  return {
    id: opts.id,
    label: opts.label,
    params: [opts.param],
    ...(opts.appliesTo ? { appliesTo: opts.appliesTo } : {}),
    isActive: f => f[opts.field] !== opts.defaultValue,
    cleared: { [opts.field]: opts.defaultValue } as Partial<SearchResultsFilters>,
    read: params => {
      const raw = params.get(opts.param);
      if (raw === null) return { [opts.field]: opts.defaultValue } as Partial<SearchResultsFilters>;
      return { [opts.field]: raw === '1' } as Partial<SearchResultsFilters>;
    },
    write: (f, params) => {
      if (f[opts.field] === opts.defaultValue) params.delete(opts.param);
      // A default-on toggle needs an explicit '0' to say "switched off".
      else params.set(opts.param, f[opts.field] ? '1' : '0');
    },
    tokens: f =>
      f[opts.field] === opts.defaultValue
        ? []
        : [
            {
              key: opts.id,
              label: opts.label,
              patch: { [opts.field]: opts.defaultValue } as Partial<SearchResultsFilters>,
              icon: { kind: 'value' },
            },
          ],
    control: { kind: 'toggle' },
    getValue: f => f[opts.field],
    setValue: next => ({ [opts.field]: next }) as Partial<SearchResultsFilters>,
  };
}

/** Turning the date filter off means dropping the preset and both bounds together. */
const DATE_CLEARED: Partial<SearchResultsFilters> = { dateRange: '', after: '', before: '' };

export const FILTER_REGISTRY: FilterEntry[] = [
  chipListEntry({
    id: 'from',
    label: 'From',
    param: 'from',
    field: 'fromUserIds',
    mentionType: ChipType.USER,
    prefix: 'from:',
    tokenPrefix: 'from:',
    resolveWith: 'user',
    matches: m => m.prefix === 'from:' && !m.id.includes('@'),
    control: { kind: 'people', placeholder: 'e.g. Emily Anderson' },
    appliesTo: notLocal,
    hidden: false,
  }),
  chipListEntry({
    id: 'fromEmail',
    label: 'From (email)',
    param: 'fromEmail',
    field: 'fromEmails',
    mentionType: ChipType.USER,
    prefix: 'from:',
    tokenPrefix: 'from:',
    resolveWith: 'raw',
    matches: m => m.prefix === 'from:' && m.id.includes('@'),
    appliesTo: notLocal,
    hidden: false,
  }),
  chipListEntry({
    id: 'toEmail',
    label: 'To',
    param: 'toEmail',
    field: 'toEmails',
    mentionType: ChipType.USER,
    prefix: 'to:',
    tokenPrefix: 'to:',
    resolveWith: 'raw',
    matches: m => m.prefix === 'to:',
    appliesTo: notLocal,
  }),
  chipListEntry({
    id: 'in',
    label: 'In',
    param: 'in',
    field: 'inChannelIds',
    mentionType: ChipType.CHANNEL,
    prefix: 'in:',
    tokenPrefix: 'in:',
    resolveWith: 'channel',
    matches: m => m.prefix === 'in:',
    control: { kind: 'channels', placeholder: 'e.g. #project-unicorn' },
    appliesTo: notLocal,
    hidden: false,
  }),
  chipListEntry({
    id: 'with',
    label: 'With',
    param: 'with',
    field: 'withUserIds',
    mentionType: ChipType.USER,
    prefix: 'with:',
    tokenPrefix: 'with:',
    resolveWith: 'user',
    matches: m => m.prefix === 'with:',
    control: { kind: 'people', placeholder: 'e.g. Paul Leung' },
    appliesTo: isMessageType,
  }),
  // ONE entry owning two state fields, the way `date` owns three. A mention is "someone
  // or something named in the message" — the user picks from one list and doesn't care
  // whether it turned out to be a person or a channel. Splitting it in two gave the
  // palette one merged typeahead and the modal two separate boxes for the same filter.
  //
  // Two URL params and two backend fields remain, because Vespa matches people against
  // `mentions` and channels against `channelMentions`; that's a storage detail the UI
  // shouldn't leak.
  {
    id: 'mentions',
    label: 'Mentions',
    params: ['mentions', 'channelMentions'],
    appliesTo: isMessageType,
    isActive: f => f.mentionUserIds.length > 0 || f.mentionChannelIds.length > 0,
    cleared: { mentionUserIds: [], mentionChannelIds: [] },
    read: params => ({
      mentionUserIds: csv(params.get('mentions')),
      mentionChannelIds: csv(params.get('channelMentions')),
    }),
    write: (f, params) => {
      setOrDelete(params, 'mentions', f.mentionUserIds.join(','));
      setOrDelete(params, 'channelMentions', f.mentionChannelIds.join(','));
    },
    chips: (f, resolve) => [
      ...f.mentionUserIds.map(id => ({
        id,
        type: ChipType.USER,
        prefix: 'mentions:' as const,
        name: resolve.userName(id) ?? id,
      })),
      ...f.mentionChannelIds.map(id => ({
        id,
        type: ChipType.CHANNEL,
        prefix: 'mentions:' as const,
        name: resolve.channelName(id) ?? id,
      })),
    ],
    // Prefix-less chips are still accepted: `hi @vishal` produced them before `mentions:`
    // existed, and a saved URL can still bring one back.
    fromChips: mentions => {
      const mine = mentions.filter(m => m.prefix === 'mentions:' || !m.prefix);
      return {
        mentionUserIds: mine.filter(m => m.type === ChipType.USER).map(m => m.id),
        mentionChannelIds: mine.filter(m => m.type === ChipType.CHANNEL).map(m => m.id),
      };
    },
    tokens: (f, resolve) => [
      ...f.mentionUserIds.map(id => ({
        key: `mentions-user-${id}`,
        prefix: 'mentions:',
        // The `@` is the mention syntax being searched for, not a type marker — an avatar
        // can't duplicate it the way the hash glyph would duplicate a `#`.
        label: `@${resolve.userName(id) ?? id}`,
        patch: { mentionUserIds: f.mentionUserIds.filter(v => v !== id) },
        icon: { kind: 'user', userId: id } as const,
      })),
      ...f.mentionChannelIds.map(id => ({
        key: `mentions-channel-${id}`,
        prefix: 'mentions:',
        label: resolve.channelName(id) ?? id,
        patch: { mentionChannelIds: f.mentionChannelIds.filter(v => v !== id) },
        icon: { kind: 'channel', channelId: id } as const,
      })),
    ],
    control: { kind: 'mentions', placeholder: 'e.g. Emily Anderson or general' },
  },
  {
    id: 'date',
    label: 'Date',
    // One filter, three params: a preset keyword or an explicit pair of bounds.
    params: ['range', 'after', 'before'],
    appliesTo: notLocal,
    isActive: f => Boolean(f.dateRange || f.after || f.before),
    cleared: { dateRange: '', after: '', before: '' },
    read: (params, typed) => ({
      dateRange: params.get('range') ?? typed.range ?? '',
      // `on:` is a one-day window; it round-trips as equal bounds.
      after: params.get('after') ?? typed.after ?? typed.on ?? '',
      before: params.get('before') ?? typed.before ?? typed.on ?? '',
    }),
    write: (f, params) => {
      setOrDelete(params, 'range', f.dateRange);
      setOrDelete(params, 'after', f.after);
      setOrDelete(params, 'before', f.before);
    },
    // Dates ride as chips (below), not text — a sub-day keyword is the one exception,
    // since it has no date form to put in a chip.
    queryText: f => (dateBounds(f) ? '' : f.dateRange ? `range:${f.dateRange}` : ''),
    chips: f => {
      const bounds = dateBounds(f);
      if (!bounds) return [];
      // A window that opens and closes on the same day is a single day — `on:` says that
      // directly, where `after:X before:X` reads like an empty range.
      if (bounds.after && bounds.after === bounds.before) {
        return [{ id: bounds.after, type: ChipType.DATE, prefix: 'on:', name: bounds.after }];
      }
      const out: ResultsMention[] = [];
      if (bounds.after) {
        out.push({
          id: bounds.after,
          type: ChipType.DATE,
          prefix: 'after:',
          name: bounds.after,
        });
      }
      if (bounds.before) {
        out.push({
          id: bounds.before,
          type: ChipType.DATE,
          prefix: 'before:',
          name: bounds.before,
        });
      }
      return out;
    },
    fromChips: mentions => {
      const dates = mentions.filter(m => m.type === ChipType.DATE);
      if (dates.length === 0) return {};
      const on = dates.find(m => m.prefix === 'on:');
      if (on) return { dateRange: '', after: on.id, before: on.id };
      return {
        dateRange: '',
        after: dates.find(m => m.prefix === 'after:')?.id ?? '',
        before: dates.find(m => m.prefix === 'before:')?.id ?? '',
      };
    },
    searchFilters: f => {
      const bounds = dateBounds(f);
      if (!bounds) return f.dateRange ? { range: f.dateRange } : {};
      return {
        ...(bounds.after ? { after: bounds.after } : {}),
        ...(bounds.before ? { before: bounds.before } : {}),
      };
    },
    control: { kind: 'date' },
    tokens: f => {
      const bounds = dateBounds(f);
      // A preset shows the window it stands for, not its keyword — `after:2026-05-28
      // before:2026-08-28` rather than `range:last three months`. Same values the query
      // is actually run with, so the box can't disagree with the search.
      if (!bounds) {
        return f.dateRange
          ? [
              {
                key: 'range',
                prefix: 'range:',
                label: f.dateRange,
                patch: DATE_CLEARED,
                icon: { kind: 'date' as const },
              },
            ]
          : [];
      }
      // Removing either half of a preset's window drops the whole preset; explicit bounds
      // are independent, so each clears only itself.
      const isPreset = Boolean(f.dateRange);
      if (bounds.after && bounds.after === bounds.before) {
        return [
          {
            key: 'on',
            prefix: 'on:',
            label: bounds.after,
            patch: DATE_CLEARED,
            icon: { kind: 'date' },
          },
        ];
      }
      const out: FilterToken[] = [];
      if (bounds.after) {
        out.push({
          key: 'after',
          prefix: 'after:',
          label: bounds.after,
          patch: isPreset ? DATE_CLEARED : { after: '' },
          icon: { kind: 'date' },
        });
      }
      if (bounds.before) {
        out.push({
          key: 'before',
          prefix: 'before:',
          label: bounds.before,
          patch: isPreset ? DATE_CLEARED : { before: '' },
          icon: { kind: 'date' },
        });
      }
      return out;
    },
  },
  toggleEntry({
    id: 'myChannels',
    label: 'Only my channels',
    param: 'myChannels',
    field: 'onlyMyChannels',
    defaultValue: DEFAULT_SEARCH_FILTERS.onlyMyChannels,
    appliesTo: notLocal,
  }),
  toggleEntry({
    id: 'automations',
    label: 'Include automations',
    param: 'automations',
    field: 'includeBotMessages',
    defaultValue: false,
    appliesTo: isMessageType,
  }),
  // Ticket-only filters last: they apply to one result type, so they sit below the
  // filters that work everywhere.
  chipListEntry({
    id: 'assignee',
    label: 'Assignee',
    param: 'assignee',
    field: 'assigneeIds',
    mentionType: ChipType.USER,
    prefix: 'assignee:',
    tokenPrefix: 'assignee:',
    resolveWith: 'user',
    matches: m => m.prefix === 'assignee:',
    control: { kind: 'people', placeholder: 'e.g. Paul Leung' },
    appliesTo: isTicketType,
  }),
  {
    id: 'priority',
    label: 'Priority',
    params: ['priority'],
    appliesTo: isTicketType,
    isActive: f => Boolean(f.priority),
    cleared: { priority: '' },
    read: params => ({ priority: params.get('priority')?.toUpperCase() ?? '' }),
    write: (f, params) => setOrDelete(params, 'priority', f.priority),
    // Priority is a chip in the palette, so it needs no query text of its own.
    chips: f =>
      f.priority ? [{ id: f.priority, type: ChipType.PRIORITY, prefix: 'priority:' }] : [],
    tokens: f =>
      f.priority
        ? [
            {
              key: 'priority',
              prefix: 'priority:',
              label: f.priority.toLowerCase(),
              patch: { priority: '' },
              icon: { kind: 'priority', value: f.priority } as const,
            },
          ]
        : [],
    fromChips: mentions => {
      const chip = mentions.find(m => m.type === ChipType.PRIORITY);
      return { priority: chip?.id ?? '' };
    },
    control: { kind: 'enumSingle', options: PRIORITY_OPTIONS, anyLabel: 'Any priority' },
    getValue: f => f.priority,
    setValue: next => ({ priority: next as string }),
  },
  textListEntry({
    id: 'status',
    label: 'Status',
    param: 'status',
    field: 'statuses',
    syntax: 'status:',
    typedKey: 'status',
    searchKey: 'status',
    // No chip and no modal control on purpose. Two different things are called "status":
    // this statusV2 lifecycle enum, and the board *stage* the ticket panel labels "Status"
    // (To Do / In Progress / Review / …). Stage names are defined per board, so a
    // workspace-wide picker would offer values that don't apply to the board being
    // searched. Both stay reachable by typing `status:` / `stage:`.
  }),
  textListEntry({
    id: 'board',
    label: 'Board',
    param: 'board',
    field: 'boardIds',
    syntax: 'board:',
    typedKey: 'board',
    searchKey: 'board',
    tokenIcon: { kind: 'board' },
    chip: {
      type: ChipType.BOARD,
      prefix: 'board:',
      label: (id, resolve) => resolve.boardName?.(id) ?? id,
    },
    control: { kind: 'boards' },
  }),
  textListEntry({
    id: 'tags',
    label: 'Tags',
    param: 'tags',
    field: 'tags',
    syntax: 'tags:',
    typedKey: 'tags',
    searchKey: 'tags',
    // Applies to messages too: the backend fans one `tags` value out to a ticket's `tags`
    // and a message's `messageActs`, so this is one filter over both.
    appliesTo: isTicketOrMessageType,
    control: { kind: 'text', placeholder: 'e.g. billing, urgent' },
  }),
];

/**
 * Explicit bounds if set, else the preset expanded to its concrete window. Null when the
 * filter carries only a keyword we can't resolve, which then travels as the keyword.
 */
function dateBounds(f: SearchResultsFilters): { after: string; before: string } | null {
  if (f.after || f.before) return { after: f.after, before: f.before };
  if (!f.dateRange) return null;
  return resolveDateKeyword(f.dateRange);
}

/** Params owned by the registry, plus the page-level ones nothing else derives. */
export const PAGE_PARAM_KEYS = ['tab', 'sort', 'rank'] as const;

export const ALL_FILTER_PARAM_KEYS: string[] = [
  ...PAGE_PARAM_KEYS,
  ...FILTER_REGISTRY.flatMap(entry => [...entry.params]),
];

/** Entries this docType can express. */
export function entriesFor(docType: DocType): FilterEntry[] {
  return FILTER_REGISTRY.filter(entry => entry.appliesTo?.(docType) ?? true);
}

/** Clears every filter the given docType can't express. */
export function clearInapplicable(filters: SearchResultsFilters): Partial<SearchResultsFilters> {
  return FILTER_REGISTRY.filter(entry => !(entry.appliesTo?.(filters.docType) ?? true)).reduce(
    (acc, entry) => ({ ...acc, ...entry.cleared }),
    {},
  );
}

/** How many filters are set — drives the Filters badge. */
export function countActiveFilters(filters: SearchResultsFilters): number {
  return entriesFor(filters.docType).filter(e => e.hidden !== false && e.isActive(filters)).length;
}

export function readFiltersFromParams(
  params: URLSearchParams,
  typed: TypedFilters,
): Partial<SearchResultsFilters> {
  return FILTER_REGISTRY.reduce(
    (acc, entry) => ({ ...acc, ...entry.read(params, typed) }),
    {} as Partial<SearchResultsFilters>,
  );
}

export function writeFiltersToParams(filters: SearchResultsFilters, params: URLSearchParams): void {
  for (const entry of FILTER_REGISTRY) entry.write(filters, params);
}

export function buildChips(
  filters: SearchResultsFilters,
  resolve: FilterResolvers,
): ResultsMention[] {
  return FILTER_REGISTRY.flatMap(entry => entry.chips?.(filters, resolve) ?? []);
}

export function buildQueryText(filters: SearchResultsFilters): string {
  return FILTER_REGISTRY.map(entry => entry.queryText?.(filters) ?? '')
    .filter(Boolean)
    .join(' ');
}

export function buildSearchFilters(filters: SearchResultsFilters): StructuredSearchFilters {
  return FILTER_REGISTRY.reduce(
    (acc, entry) => ({ ...acc, ...(entry.searchFilters?.(filters) ?? {}) }),
    {} as StructuredSearchFilters,
  );
}

/**
 * The inverse of `buildChips`: the palette's selected chips turned back into filters, so
 * its hand-off to the results page goes through the same definitions the page reads with.
 */
export function filtersFromChips(mentions: ResultsMention[]): Partial<SearchResultsFilters> {
  return FILTER_REGISTRY.reduce(
    (acc, entry) => ({ ...acc, ...(entry.fromChips?.(mentions) ?? {}) }),
    {} as Partial<SearchResultsFilters>,
  );
}

export function buildTokens(
  filters: SearchResultsFilters,
  resolve: FilterResolvers,
): FilterToken[] {
  return entriesFor(filters.docType).flatMap(entry => entry.tokens?.(filters, resolve) ?? []);
}
