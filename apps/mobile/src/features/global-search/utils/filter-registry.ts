/**
 * Mobile port of dashboard `filterRegistry` — modal fields, visibility, badge count.
 * Mode toggles stay on the filter bar and are excluded from the sheet.
 */

import type { SearchFilterChip } from '../types';
import type { GlobalSearchTab } from './search-tabs';
import {
  DATE_RANGE_OPTIONS,
  DEFAULT_STRUCTURED_FILTERS,
  PRIORITY_OPTIONS,
  type FilterEntity,
  type SearchDocType,
  type SearchResultsFilters,
  type StructuredSearchFilters,
} from './filter-model';

export { DATE_RANGE_OPTIONS, PRIORITY_OPTIONS };

export type FilterControl =
  | { kind: 'people'; placeholder: string; field: 'fromUsers' | 'withUsers' | 'assignees' }
  | { kind: 'channels'; placeholder: string; field: 'inChannels'; excludeDMs?: boolean }
  | { kind: 'mentions'; placeholder: string }
  | { kind: 'boards'; placeholder: string }
  | {
      kind: 'enumSingle';
      options: ReadonlyArray<{ value: string; label: string }>;
      anyLabel: string;
      field: 'priority';
    }
  | { kind: 'text'; placeholder: string; field: 'tags' | 'entities' }
  | { kind: 'date' }
  | { kind: 'checkbox'; field: 'showArchived' };

export type ModalFilterEntry = {
  id: string;
  label: string;
  /** When false, excluded from the Filters badge (has its own bar control). */
  hidden?: boolean;
  appliesTo: (docType: SearchDocType) => boolean;
  isActive: (f: SearchResultsFilters) => boolean;
  control?: FilterControl;
  /** No control — shown under “From your search” when active. */
  carried?: boolean;
};

const isTicketType = (d: SearchDocType): boolean => d === 'tickets' || d === 'all';
const isMessageType = (d: SearchDocType): boolean => d === 'messages' || d === 'all';
const isTicketOrMessageType = (d: SearchDocType): boolean => isTicketType(d) || isMessageType(d);
const isLocalType = (d: SearchDocType): boolean => d === 'channels' || d === 'people';
const notLocal = (d: SearchDocType): boolean => !isLocalType(d);

/**
 * Map mobile tabs onto dashboard docType for appliesTo / request shaping.
 * Local-only tabs behave like channels/people for *search* category gating.
 */
export function docTypeForTab(tab: GlobalSearchTab): SearchDocType {
  switch (tab) {
    case 'messages':
      return 'messages';
    case 'tickets':
      return 'tickets';
    case 'files':
      return 'files';
    case 'calls':
      // Calls are remote; From/With/Date apply. Treat as messages for “with”.
      return 'messages';
    case 'chats':
      return 'people';
    case 'channels':
      return 'channels';
  }
}

/**
 * Filters drawer visibility. Mobile has no Type=All control; the drawer always
 * matches dashboard's `all` filter set (From / In / With / Mentions / Date /
 * Assignee / Priority / Board / Tags / Entity). Opening from DMs lands on the
 * Chats tab, which would otherwise map to `people` and show an empty sheet.
 */
export function modalDocTypeForTab(_tab: GlobalSearchTab): SearchDocType {
  return 'all';
}

export const FILTER_MODAL_ENTRIES: readonly ModalFilterEntry[] = [
  {
    id: 'from',
    label: 'From',
    appliesTo: notLocal,
    hidden: false,
    isActive: f => f.fromUsers.length > 0,
    control: {
      kind: 'people',
      placeholder: 'e.g. Emily Anderson',
      field: 'fromUsers',
    },
  },
  {
    id: 'fromEmail',
    label: 'From (email)',
    appliesTo: notLocal,
    carried: true,
    isActive: f => f.fromEmails.length > 0,
  },
  {
    id: 'toEmail',
    label: 'To',
    appliesTo: notLocal,
    carried: true,
    isActive: f => f.toEmails.length > 0,
  },
  {
    id: 'in',
    label: 'In',
    appliesTo: notLocal,
    hidden: false,
    isActive: f => f.inChannels.length > 0,
    control: {
      kind: 'channels',
      placeholder: 'e.g. #project-unicorn',
      field: 'inChannels',
    },
  },
  {
    id: 'with',
    label: 'With',
    appliesTo: isMessageType,
    isActive: f => f.withUsers.length > 0,
    control: {
      kind: 'people',
      placeholder: 'e.g. Paul Leung',
      field: 'withUsers',
    },
  },
  {
    id: 'mentions',
    label: 'Mentions',
    appliesTo: isMessageType,
    isActive: f =>
      f.mentionUsers.length > 0 || f.mentionChannels.length > 0 || f.mentionGroups.length > 0,
    control: {
      kind: 'mentions',
      placeholder: 'e.g. Emily Anderson, general or Frontend Team',
    },
  },
  {
    id: 'date',
    label: 'Date',
    appliesTo: notLocal,
    isActive: f => Boolean(f.dateRange || f.after || f.before),
    control: { kind: 'date' },
  },
  {
    id: 'assignee',
    label: 'Assignee',
    appliesTo: isTicketType,
    isActive: f => f.assignees.length > 0,
    control: {
      kind: 'people',
      placeholder: 'e.g. Paul Leung',
      field: 'assignees',
    },
  },
  {
    id: 'priority',
    label: 'Priority',
    appliesTo: isTicketType,
    isActive: f => f.priority !== '',
    control: {
      kind: 'enumSingle',
      options: PRIORITY_OPTIONS,
      anyLabel: 'Any priority',
      field: 'priority',
    },
  },
  {
    id: 'status',
    label: 'Status',
    appliesTo: isTicketType,
    carried: true,
    isActive: f => f.statuses.length > 0,
  },
  {
    id: 'board',
    label: 'Board',
    appliesTo: isTicketType,
    isActive: f => f.boards.length > 0,
    control: {
      kind: 'boards',
      placeholder: 'e.g. Platform',
    },
  },
  {
    id: 'tags',
    label: 'Tags',
    appliesTo: isTicketOrMessageType,
    isActive: f => f.tags.length > 0,
    control: {
      kind: 'text',
      placeholder: 'e.g. billing, urgent',
      field: 'tags',
    },
  },
  {
    id: 'entity',
    label: 'Entity',
    appliesTo: isTicketOrMessageType,
    isActive: f => f.entities.length > 0,
    control: {
      kind: 'text',
      placeholder: 'e.g. Big Basket, Swiggy',
      field: 'entities',
    },
  },
  {
    id: 'showArchived',
    label: 'Show archived',
    appliesTo: d => d === 'desk' || d === 'tickets',
    // Counted in badge (modal-only checkbox).
    hidden: true,
    isActive: f => f.showArchived,
    control: { kind: 'checkbox', field: 'showArchived' },
  },
];

export function entriesFor(docType: SearchDocType): ModalFilterEntry[] {
  return FILTER_MODAL_ENTRIES.filter(entry => entry.appliesTo(docType));
}

export function modalFieldEntries(docType: SearchDocType): ModalFilterEntry[] {
  return entriesFor(docType).filter(
    entry => entry.control && entry.control.kind !== undefined && !entry.carried,
  );
}

/**
 * Badge = active modal filters, excluding From/In (`hidden: false`) and bar toggles.
 */
export function countActiveFilters(filters: SearchResultsFilters): number {
  return entriesFor(filters.docType).filter(
    entry => entry.hidden !== false && entry.isActive(filters),
  ).length;
}

export function chipsToEntities(
  chips: readonly SearchFilterChip[],
  prefix: 'from:' | 'in:',
): FilterEntity[] {
  return chips
    .filter(chip => chip.prefix === prefix)
    .map(chip => ({ id: chip.id, label: chip.label }));
}

export function entitiesToFromChips(entities: readonly FilterEntity[]): SearchFilterChip[] {
  return entities.map(entity => ({
    id: entity.id,
    label: entity.label,
    prefix: 'from:',
    entityType: 'user',
  }));
}

export function entitiesToInChips(entities: readonly FilterEntity[]): SearchFilterChip[] {
  return entities.map(entity => ({
    id: entity.id,
    label: entity.label,
    prefix: 'in:',
    entityType: 'channel',
  }));
}

export function toSearchResultsFilters(input: {
  tab: GlobalSearchTab;
  chips: readonly SearchFilterChip[];
  structured: StructuredSearchFilters;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
}): SearchResultsFilters {
  return {
    docType: modalDocTypeForTab(input.tab),
    fromUsers: chipsToEntities(input.chips, 'from:'),
    inChannels: chipsToEntities(input.chips, 'in:'),
    onlyMyChannels: input.onlyMyChannels,
    includeBotMessages: input.includeBotMessages,
    exactMatch: input.exactMatch,
    ...input.structured,
  };
}

/** Drop structured fields that do not apply to the active tab. */
export function clearInapplicableStructured(
  tab: GlobalSearchTab,
  structured: StructuredSearchFilters,
  chips: readonly SearchFilterChip[],
): { structured: StructuredSearchFilters; chips: readonly SearchFilterChip[] } {
  const docType = docTypeForTab(tab);
  const visible = new Set(entriesFor(docType).map(entry => entry.id));
  let nextChips = chips;
  let next = { ...structured };

  if (!visible.has('from')) {
    nextChips = nextChips.filter(chip => chip.prefix !== 'from:');
  }
  if (!visible.has('in')) {
    nextChips = nextChips.filter(chip => chip.prefix !== 'in:');
  }
  if (!visible.has('with')) next = { ...next, withUsers: [] };
  if (!visible.has('mentions')) {
    next = { ...next, mentionUsers: [], mentionChannels: [], mentionGroups: [] };
  }
  if (!visible.has('date')) {
    next = { ...next, dateRange: '', after: '', before: '' };
  }
  if (!visible.has('assignee')) next = { ...next, assignees: [] };
  if (!visible.has('priority')) next = { ...next, priority: '' };
  if (!visible.has('status')) next = { ...next, statuses: [] };
  if (!visible.has('board')) next = { ...next, boards: [] };
  if (!visible.has('tags')) next = { ...next, tags: [] };
  if (!visible.has('entity')) next = { ...next, entities: [] };
  if (!visible.has('showArchived')) next = { ...next, showArchived: false };
  if (!visible.has('fromEmail')) next = { ...next, fromEmails: [] };
  if (!visible.has('toEmail')) next = { ...next, toEmails: [] };

  return { structured: next, chips: nextChips };
}

export function emptyStructuredFilters(): StructuredSearchFilters {
  return { ...DEFAULT_STRUCTURED_FILTERS };
}
