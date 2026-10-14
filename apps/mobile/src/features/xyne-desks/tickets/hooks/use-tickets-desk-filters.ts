import { useCallback, useEffect, useState } from 'react';

import type { TicketMailboxFolder } from '../types';
import type { DynamicFieldFilterValue } from '../utils/dynamic-field-filters';
import type { TicketsDateRange } from '../utils/format-date-filter-label';
import { emptyTicketsDeskFilters } from '../utils/tickets-desk-filters';

export function useTicketsDeskFilters(channelId: string) {
  const initial = emptyTicketsDeskFilters();
  const [myTicketsOnly, setMyTicketsOnly] = useState(initial.myTicketsOnly);
  const [assigneeIds, setAssigneeIds] = useState(initial.assigneeIds);
  const [createdByIds, setCreatedByIds] = useState(initial.createdByIds);
  const [priorities, setPriorities] = useState(initial.priorities);
  const [stageNames, setStageNames] = useState(initial.stageNames);
  const [hasAiDraft, setHasAiDraft] = useState(initial.hasAiDraft);
  const [hasSubTickets, setHasSubTickets] = useState(initial.hasSubTickets);
  const [aiCategories, setAiCategories] = useState(initial.aiCategories);
  const [generatedTags, setGeneratedTags] = useState(initial.generatedTags);
  const [userGroupIds, setUserGroupIds] = useState(initial.userGroupIds);
  const [conversationLabelId, setConversationLabelId] = useState(initial.conversationLabelId);
  const [dynamicFields, setDynamicFields] = useState<Record<string, DynamicFieldFilterValue>>(
    initial.dynamicFields,
  );
  const [lastUpdatedRange, setLastUpdatedRange] = useState<TicketsDateRange>(
    initial.lastUpdatedRange,
  );
  const [dateRange, setDateRange] = useState<TicketsDateRange>(initial.dateRange);
  const [activeFolder, setActiveFolder] = useState<TicketMailboxFolder>(initial.activeFolder);

  useEffect(() => {
    const next = emptyTicketsDeskFilters();
    setMyTicketsOnly(next.myTicketsOnly);
    setAssigneeIds(next.assigneeIds);
    setCreatedByIds(next.createdByIds);
    setPriorities(next.priorities);
    setStageNames(next.stageNames);
    setHasAiDraft(next.hasAiDraft);
    setHasSubTickets(next.hasSubTickets);
    setAiCategories(next.aiCategories);
    setGeneratedTags(next.generatedTags);
    setUserGroupIds(next.userGroupIds);
    setConversationLabelId(next.conversationLabelId);
    setDynamicFields(next.dynamicFields);
    setLastUpdatedRange(next.lastUpdatedRange);
    setDateRange(next.dateRange);
    setActiveFolder(next.activeFolder);
  }, [channelId]);

  const clearAllFilters = useCallback(() => {
    const next = emptyTicketsDeskFilters();
    setMyTicketsOnly(next.myTicketsOnly);
    setAssigneeIds(next.assigneeIds);
    setCreatedByIds(next.createdByIds);
    setPriorities(next.priorities);
    setStageNames(next.stageNames);
    setHasAiDraft(next.hasAiDraft);
    setHasSubTickets(next.hasSubTickets);
    setAiCategories(next.aiCategories);
    setGeneratedTags(next.generatedTags);
    setUserGroupIds(next.userGroupIds);
    setConversationLabelId(next.conversationLabelId);
    setDynamicFields(next.dynamicFields);
    setLastUpdatedRange(next.lastUpdatedRange);
    setDateRange(next.dateRange);
  }, []);

  return {
    myTicketsOnly,
    setMyTicketsOnly,
    assigneeIds,
    setAssigneeIds,
    createdByIds,
    setCreatedByIds,
    priorities,
    setPriorities,
    stageNames,
    setStageNames,
    hasAiDraft,
    setHasAiDraft,
    hasSubTickets,
    setHasSubTickets,
    aiCategories,
    setAiCategories,
    generatedTags,
    setGeneratedTags,
    userGroupIds,
    setUserGroupIds,
    conversationLabelId,
    setConversationLabelId,
    dynamicFields,
    setDynamicFields,
    lastUpdatedRange,
    setLastUpdatedRange,
    dateRange,
    setDateRange,
    activeFolder,
    setActiveFolder,
    clearAllFilters,
  };
}

export type UseTicketsDeskFiltersReturn = ReturnType<typeof useTicketsDeskFilters>;
