import type { TicketPriority } from '@xyne/shared';

import { CHANNEL_TICKETS_PAGE_SIZE } from './constants';

/**
 * Args for `queries.supportTicketsPageV3` as used by the channel tickets table.
 *
 * Shared by the Info-screen warm-up (`load.ts`) and the data hook so both build
 * byte-identical args for the unfiltered first page and therefore hit the same
 * cached Zero query. Keep this file free of React / RN imports.
 */
export type ChannelTicketsPageArgs = {
  channelId: string;
  isMember: boolean;
  assignedTo?: string[];
  priority?: TicketPriority[];
  stageName?: string[];
  limit: number;
  start: null;
  dir: 'forward';
};

export type ChannelTicketsQueryFilters = {
  assigneeIds?: readonly string[] | undefined;
  priorities?: readonly TicketPriority[] | undefined;
  stageNames?: readonly string[] | undefined;
};

/** Sorted, de-duplicated copy so equal selections yield equal query keys. */
export function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(new Set(values)).sort();
}

/** `limit` for a window of `pages` pages, plus one sentinel row for has-more. */
export function channelTicketsLimitForPages(pages: number): number {
  const safePages = Math.max(1, Math.floor(pages));
  return CHANNEL_TICKETS_PAGE_SIZE * safePages + 1;
}

export function buildChannelTicketsPageArgs(
  channelId: string,
  isMember: boolean,
  filters: ChannelTicketsQueryFilters,
  pages: number,
): ChannelTicketsPageArgs {
  const assignedTo = normalizeStringList(filters.assigneeIds);
  const priority = normalizeStringList(filters.priorities) as TicketPriority[];
  const stageName = normalizeStringList(filters.stageNames);

  return {
    channelId,
    isMember,
    ...(assignedTo.length > 0 ? { assignedTo } : {}),
    ...(priority.length > 0 ? { priority } : {}),
    ...(stageName.length > 0 ? { stageName } : {}),
    limit: channelTicketsLimitForPages(pages),
    start: null,
    dir: 'forward',
  };
}

/** Stable key for a filter selection; drives paging resets and paint-cache eligibility. */
export function channelTicketsFiltersKey(filters: ChannelTicketsQueryFilters): string {
  return [
    normalizeStringList(filters.assigneeIds).join(','),
    normalizeStringList(filters.priorities).join(','),
    normalizeStringList(filters.stageNames).join(','),
  ].join('|');
}
