import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TicketPriority } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUserChannelStatuses } from '@/src/hooks/useChannels';
import { queries } from '@/src/zero/queries';

import type { TicketListItemData, TicketMailboxFolder } from '../types';
import {
  filterSupportTicketsByCreatedAt,
  filterSupportTicketsByLastEmailAt,
  mapSupportTicketsToListItems,
  type SupportTicketRowLike,
} from '../utils/map-support-tickets-to-list-items';
import { filterSupportTicketsByMailboxFolder } from '../utils/filter-support-tickets-by-mailbox-folder';
import { expandAssignedToQueryValues } from '../utils/expand-assigned-to-query-values';
import {
  filterSupportTicketsByDynamicFieldClientFilters,
  type DynamicFieldClientFilter,
  type DynamicFieldQueryFilter,
} from '../utils/dynamic-field-filters';
import {
  computeTicketsListPaging,
  nextTicketsListPages,
  shouldAutoGrowTicketsList,
  ticketsListLimitForPages,
} from '../utils/tickets-list-paging';
import {
  clearTicketsPaintCache,
  getTicketsPaintCache,
  setTicketsPaintCache,
} from '../utils/tickets-list-paint-cache';

type PagesState = { key: string; pages: number };

export type UseTicketsListDataOptions = {
  assignedTo?: readonly string[];
  createdBy?: readonly string[];
  priority?: readonly TicketPriority[];
  stageName?: readonly string[];
  aiCategory?: readonly string[];
  /** From AI Tags REST → conversationIds (V4). */
  conversationIds?: readonly string[];
  hasAiDraft?: boolean;
  hasSubTickets?: boolean;
  userGroups?: readonly string[];
  conversationLabelId?: string;
  dynamicFieldFilters?: readonly DynamicFieldQueryFilter[];
  /** MULTI_SELECT values — V4 only checks field presence; thin the page here. */
  dynamicFieldClientFilters?: readonly DynamicFieldClientFilter[];
  /** EMAIL desk folder pill → V4 `mailboxFolder` (+ client Inbox/All Mail refine). */
  mailboxFolder?: TicketMailboxFolder;
  /** Also sent as V4 createdAtStart/End; client fallback until shared dates land. */
  createdDateStart?: number;
  createdDateEnd?: number;
  lastEmailAtStart?: number;
  lastEmailAtEnd?: number;
};

export type UseTicketsListDataReturn = {
  items: TicketListItemData[];
  isEmpty: boolean;
  isMember: boolean;
  isInitialLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
};

function stableStringListKey(values: readonly string[] | undefined): string {
  return values?.length ? [...values].sort().join('\0') : '';
}

function stableDynamicFieldKey(filters: readonly DynamicFieldQueryFilter[] | undefined): string {
  if (!filters?.length) return '';
  return filters
    .map(f => {
      const values = f.values?.length ? [...f.values].map(String).sort().join(',') : '';
      return `${f.fieldId}:${values}`;
    })
    .sort()
    .join('\0');
}

/**
 * Desk tickets for a channel — local-first / optimistic via supportTicketsPageV4.
 * Growing window (PAGE_SIZE * pages + 1 sentinel), same contract as channel tickets.
 * Inbox / All Mail / date predicates stay client-side and auto-grow a sparse first page.
 */
export function useTicketsListData(
  channelId: string,
  options?: UseTicketsListDataOptions,
): UseTicketsListDataReturn {
  const { workspaceSessionKey: sessionKey } = useAuth();
  const userChannelStatuses = useUserChannelStatuses();

  const assignedToKey = stableStringListKey(options?.assignedTo);
  const assignedTo = useMemo(
    () => (assignedToKey ? expandAssignedToQueryValues(assignedToKey.split('\0')) : undefined),
    [assignedToKey],
  );

  const createdByKey = stableStringListKey(options?.createdBy);
  const createdBy = useMemo(
    () => (createdByKey ? expandAssignedToQueryValues(createdByKey.split('\0')) : undefined),
    [createdByKey],
  );

  const priorityKey = stableStringListKey(options?.priority);
  const priority = useMemo(
    () => (priorityKey ? (priorityKey.split('\0') as TicketPriority[]) : undefined),
    [priorityKey],
  );

  const stageNameKey = stableStringListKey(options?.stageName);
  const stageName = useMemo(
    () => (stageNameKey ? stageNameKey.split('\0') : undefined),
    [stageNameKey],
  );

  const aiCategoryKey = stableStringListKey(options?.aiCategory);
  const aiCategory = useMemo(
    () => (aiCategoryKey ? aiCategoryKey.split('\0') : undefined),
    [aiCategoryKey],
  );

  const conversationIdsKey = stableStringListKey(options?.conversationIds);
  const conversationIds = useMemo(() => {
    if (options?.conversationIds === undefined) return undefined;
    return conversationIdsKey ? conversationIdsKey.split('\0') : [];
  }, [options?.conversationIds, conversationIdsKey]);

  const userGroupsKey = stableStringListKey(options?.userGroups);
  const userGroups = useMemo(
    () => (userGroupsKey ? userGroupsKey.split('\0') : undefined),
    [userGroupsKey],
  );

  const dynamicFieldKey = stableDynamicFieldKey(options?.dynamicFieldFilters);
  const dynamicFieldFilters = useMemo(() => {
    if (!dynamicFieldKey || !options?.dynamicFieldFilters?.length) return undefined;
    return options.dynamicFieldFilters.map(f => ({
      fieldId: f.fieldId,
      ...(f.values?.length ? { values: [...f.values] } : {}),
    }));
  }, [dynamicFieldKey, options?.dynamicFieldFilters]);

  const dynamicFieldClientKey = stableDynamicFieldKey(
    options?.dynamicFieldClientFilters?.map(f => ({
      fieldId: f.fieldId,
      values: [...f.values],
    })),
  );
  const dynamicFieldClientFilters = useMemo(() => {
    if (!dynamicFieldClientKey || !options?.dynamicFieldClientFilters?.length) return [];
    return options.dynamicFieldClientFilters.map(f => ({
      fieldId: f.fieldId,
      values: [...f.values],
    }));
  }, [dynamicFieldClientKey, options?.dynamicFieldClientFilters]);

  const hasAiDraft = options?.hasAiDraft === true;
  const hasSubTickets = options?.hasSubTickets === true;
  const conversationLabelId = options?.conversationLabelId?.trim() || undefined;
  const mailboxFolder = options?.mailboxFolder;
  const createdDateStart = options?.createdDateStart;
  const createdDateEnd = options?.createdDateEnd;
  const lastEmailAtStart = options?.lastEmailAtStart;
  const lastEmailAtEnd = options?.lastEmailAtEnd;
  const hasCreatedDateFilter = createdDateStart != null || createdDateEnd != null;
  const hasLastUpdatedFilter = lastEmailAtStart != null || lastEmailAtEnd != null;
  // Every explicit folder (including Inbox) is a filter — do not reuse the
  // unfiltered channel paint cache, or spam / overlay-archived can flash in.
  // x != null              // skips both null and undefined
  // x !== undefined        // skips only undefined; null still passes
  const hasMailboxFolderFilter = mailboxFolder != null;
  const hasClientThinningFilter =
    mailboxFolder === 'inbox' ||
    mailboxFolder === 'all' ||
    hasCreatedDateFilter ||
    hasLastUpdatedFilter ||
    dynamicFieldClientFilters.length > 0;

  const hasListFilter = Boolean(
    assignedTo?.length ||
    createdBy?.length ||
    priority?.length ||
    stageName?.length ||
    aiCategory?.length ||
    conversationIds !== undefined ||
    hasAiDraft ||
    hasSubTickets ||
    userGroups?.length ||
    conversationLabelId ||
    dynamicFieldFilters?.length ||
    hasCreatedDateFilter ||
    hasLastUpdatedFilter ||
    hasMailboxFolderFilter,
  );

  const isMember = useMemo(() => {
    if (!channelId) return false;
    return userChannelStatuses.some(s => s.channelId === channelId);
  }, [userChannelStatuses, channelId]);

  const windowKey = [
    channelId,
    assignedToKey,
    createdByKey,
    priorityKey,
    stageNameKey,
    aiCategoryKey,
    conversationIdsKey,
    userGroupsKey,
    dynamicFieldKey,
    dynamicFieldClientKey,
    hasAiDraft ? '1' : '',
    hasSubTickets ? '1' : '',
    conversationLabelId ?? '',
    mailboxFolder ?? '',
    createdDateStart ?? '',
    createdDateEnd ?? '',
    lastEmailAtStart ?? '',
    lastEmailAtEnd ?? '',
  ].join('\0');

  const [pagesState, setPagesState] = useState<PagesState>({ key: windowKey, pages: 1 });
  const pages = pagesState.key === windowKey ? pagesState.pages : 1;
  const isUnfilteredFirstPage = !hasListFilter && pages === 1;

  const [page, pageDetails] = useCachedQuery(
    queries.supportTicketsPageV4({
      channelId,
      isMember,
      ...(assignedTo ? { assignedTo } : {}),
      ...(createdBy ? { createdBy } : {}),
      ...(priority ? { priority } : {}),
      ...(stageName ? { stageName } : {}),
      ...(aiCategory ? { aiCategory } : {}),
      ...(conversationIds !== undefined ? { conversationIds } : {}),
      ...(hasAiDraft ? { hasAiDraft: true } : {}),
      ...(hasSubTickets ? { hasSubTickets: true } : {}),
      ...(mailboxFolder ? { mailboxFolder } : {}),
      ...(userGroups ? { userGroups } : {}),
      ...(conversationLabelId ? { conversationLabelId } : {}),
      ...(dynamicFieldFilters ? { dynamicFieldFilters } : {}),
      ...(createdDateStart != null ? { createdAtStart: createdDateStart } : {}),
      ...(createdDateEnd != null ? { createdAtEnd: createdDateEnd } : {}),
      ...(lastEmailAtStart != null ? { lastEmailAtStart } : {}),
      ...(lastEmailAtEnd != null ? { lastEmailAtEnd } : {}),
      limit: ticketsListLimitForPages(pages),
      start: null,
      dir: 'forward',
    }),
    {
      enabled: Boolean(channelId),
      ttl: '10m',
    },
  );

  const isComplete = pageDetails.type === 'complete';
  const paging = useMemo(
    () =>
      computeTicketsListPaging({
        pages,
        receivedCount: page?.length ?? 0,
        isComplete,
      }),
    [pages, page?.length, isComplete],
  );

  const paintSeed = useMemo(
    () => (isUnfilteredFirstPage ? getTicketsPaintCache(sessionKey, channelId) : []),
    [sessionKey, channelId, isUnfilteredFirstPage],
  );
  const lastGoodRef = useRef<TicketListItemData[]>(paintSeed);

  useEffect(() => {
    lastGoodRef.current = isUnfilteredFirstPage ? getTicketsPaintCache(sessionKey, channelId) : [];
  }, [sessionKey, channelId, isUnfilteredFirstPage]);

  const liveItems = useMemo(() => {
    const pageRows = ((page ?? []) as SupportTicketRowLike[]).slice(0, paging.visibleLimit);
    const byMailbox = filterSupportTicketsByMailboxFolder(pageRows, mailboxFolder);
    const byCreated = filterSupportTicketsByCreatedAt(
      byMailbox as SupportTicketRowLike[],
      createdDateStart,
      createdDateEnd,
    );
    const byLastEmail = filterSupportTicketsByLastEmailAt(
      byCreated,
      lastEmailAtStart,
      lastEmailAtEnd,
    );
    const filtered = filterSupportTicketsByDynamicFieldClientFilters(
      byLastEmail,
      dynamicFieldClientFilters,
    );
    // APP/Slack omit mailboxFolder — keep the archive guard. All Mail may pass
    // overlay-archived rows (isArchived false); ticket-level archived is dropped
    // in the mailbox predicate to match V4.
    return mapSupportTicketsToListItems(filtered, {
      includeArchived: mailboxFolder === 'all',
    });
  }, [
    page,
    paging.visibleLimit,
    mailboxFolder,
    createdDateStart,
    createdDateEnd,
    lastEmailAtStart,
    lastEmailAtEnd,
    dynamicFieldClientFilters,
  ]);

  useEffect(() => {
    if (!isUnfilteredFirstPage) {
      lastGoodRef.current = liveItems;
      return;
    }

    if (liveItems.length > 0) {
      lastGoodRef.current = liveItems;
      setTicketsPaintCache(sessionKey, channelId, liveItems);
      return;
    }

    if (isComplete) {
      lastGoodRef.current = [];
      clearTicketsPaintCache(sessionKey, channelId);
    }
  }, [liveItems, sessionKey, channelId, isComplete, isUnfilteredFirstPage]);

  const queryPending = !isComplete;
  const fallback = lastGoodRef.current.length > 0 ? lastGoodRef.current : paintSeed;

  const items =
    liveItems.length > 0 ? liveItems : queryPending && fallback.length > 0 ? fallback : liveItems;

  const loadMore = useCallback(() => {
    setPagesState(prev => {
      const current = prev.key === windowKey ? prev.pages : 1;
      const next = nextTicketsListPages(current, paging);
      return next === current && prev.key === windowKey ? prev : { key: windowKey, pages: next };
    });
  }, [windowKey, paging]);

  useEffect(() => {
    if (!isComplete) return;
    if (shouldAutoGrowTicketsList(items.length, hasClientThinningFilter, paging)) loadMore();
  }, [isComplete, items.length, hasClientThinningFilter, paging, loadMore]);

  const isInitialLoading =
    items.length === 0 && (!isComplete || (hasClientThinningFilter && paging.hasMore));
  const isEmpty = items.length === 0 && isComplete && !paging.hasMore;

  return {
    items,
    isEmpty,
    isMember,
    isInitialLoading,
    hasMore: paging.hasMore,
    isLoadingMore: paging.isLoadingMore,
    loadMore,
  };
}
