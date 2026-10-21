import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { FormFieldType, TicketPriority } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { getDeskChannelKind } from '@/src/features/xyne-desks/detail/utils/desk-channel-kind';
import { useChannelById } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { getUserDisplayName } from '@/src/utils/channel-utils';

import {
  useGeneratedTagsConversationIds,
  useTicketAiCategoryFilterOptions,
  useTicketAiTagsFilterOptions,
  useTicketConversationLabelFilterOptions,
  useTicketDynamicFieldFilterOptions,
  useTicketStageFilterOptions,
  useTicketsAssigneeFilterOverlay,
  useTicketsDeskFilters,
  useTicketsFilterOverlay,
  useTicketsListData,
  useTicketsSearchOverlay,
  useTicketsSelection,
  useTicketUserGroupFilterOptions,
} from '../hooks';
import { TICKETS_SELECTION_FADE_MS } from '../constants';
import type { TicketMailboxFolder, TicketsFilterDrawerItem, TicketsFilterKind } from '../types';
import {
  buildDynamicFieldFilterEntries,
  toDynamicFieldClientFilters,
  formatAssigneeFilterLabel,
  formatDateFilterLabel,
  formatMultiSelectFilterLabel,
  formatPriorityFilterLabel,
  isDateRangeActive,
  resolveConversationLabelId,
  toDynamicFieldQueryFilters,
  type TicketsDateRange,
} from '../utils';
import { TicketsAssigneeFilterOverlay } from './tickets-assignee-filter';
import { TicketsComposeFab } from './tickets-compose-fab';
import { TicketsDateFilterOverlay } from './tickets-date-filter';
import { TicketsFilterDrawer, type TicketsFilterDrawerToggleKind } from './tickets-filter-drawer';
import { TicketsList } from './tickets-list';
import { TicketsListHeader } from './tickets-list-header';
import { TicketsMultiSelectFilterOverlay } from './tickets-multi-select-filter';
import { TicketsPriorityFilterSheet } from './tickets-priority-filter';
import { TicketsSearchOverlay } from './tickets-search-overlay';

type PendingFilter = {
  kind: TicketsFilterKind;
  fieldId?: string | undefined;
};

export default function TicketsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const { channelId: channelIdParam } = useLocalSearchParams<{ channelId: string }>();
  const channelId = typeof channelIdParam === 'string' ? channelIdParam : '';

  const channel = useChannelById(channelId);
  const channelName = channel?.name?.trim() || 'Desk';
  const isMailboxDesk = getDeskChannelKind(channel?.type) === 'mailbox';
  const users = useUsers();

  const {
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
  } = useTicketsDeskFilters(channelId);
  const [prioritySheetOpen, setPrioritySheetOpen] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const pendingFilterRef = useRef<PendingFilter | null>(null);
  const [activeDynamicFieldId, setActiveDynamicFieldId] = useState<string | null>(null);

  const { options: stageOptions } = useTicketStageFilterOptions(channelId);
  const { options: aiCategoryOptions } = useTicketAiCategoryFilterOptions(channelId);
  const { options: aiTagsOptions } = useTicketAiTagsFilterOptions(channelId);
  const { options: userGroupOptions } = useTicketUserGroupFilterOptions();
  const { options: labelOptions, isAvailable: isLabelFilterAvailable } =
    useTicketConversationLabelFilterOptions(channelId);
  const { fields: dynamicFieldDefs, fieldTypesById } =
    useTicketDynamicFieldFilterOptions(channelId);
  const { conversationIds: tagConversationIds } = useGeneratedTagsConversationIds(
    channelId,
    generatedTags,
  );

  useEffect(() => {
    setPrioritySheetOpen(false);
    setFiltersDrawerOpen(false);
    pendingFilterRef.current = null;
    setActiveDynamicFieldId(null);
  }, [channelId]);

  const assigneeFilterLabel = useMemo(() => {
    if (assigneeIds.length === 0) return formatAssigneeFilterLabel([]);
    const byId = new Map(users.map(u => [u.id, u]));
    const names = assigneeIds.map(id => {
      const userRow = byId.get(id);
      return userRow ? getUserDisplayName(userRow) : 'Unknown';
    });
    return formatAssigneeFilterLabel(names);
  }, [assigneeIds, users]);

  const createdByFilterLabel = useMemo(() => {
    if (createdByIds.length === 0) return formatAssigneeFilterLabel([]);
    const byId = new Map(users.map(u => [u.id, u]));
    const names = createdByIds.map(id => {
      const userRow = byId.get(id);
      return userRow ? getUserDisplayName(userRow) : 'Unknown';
    });
    return formatAssigneeFilterLabel(names);
  }, [createdByIds, users]);

  const priorityFilterLabel = useMemo(() => formatPriorityFilterLabel(priorities), [priorities]);
  const stageFilterLabel = useMemo(
    () => formatMultiSelectFilterLabel(stageNames, 'Stages'),
    [stageNames],
  );
  const aiCategoryFilterLabel = useMemo(
    () => formatMultiSelectFilterLabel(aiCategories, 'AI Category'),
    [aiCategories],
  );
  const aiTagsFilterLabel = useMemo(() => {
    if (generatedTags.length === 0) return formatMultiSelectFilterLabel([], 'AI Tags');
    const labels = generatedTags.map(id => {
      const colon = id.indexOf(':');
      return colon >= 0 ? id.slice(colon + 1) : id;
    });
    return formatMultiSelectFilterLabel(labels, 'AI Tags');
  }, [generatedTags]);

  const userGroupFilterLabel = useMemo(() => {
    if (userGroupIds.length === 0) return formatMultiSelectFilterLabel([], 'User Groups');
    const byId = new Map(userGroupOptions.map(o => [o.id, o.label]));
    const names = userGroupIds.map(id => byId.get(id) ?? 'Unknown');
    return formatMultiSelectFilterLabel(names, 'User Groups');
  }, [userGroupIds, userGroupOptions]);

  const labelFilterLabel = useMemo(() => {
    if (!conversationLabelId) return formatMultiSelectFilterLabel([], 'Label');
    const match = labelOptions.find(o => o.id === conversationLabelId);
    return match?.label ?? '1 selected';
  }, [conversationLabelId, labelOptions]);

  const lastUpdatedFilterLabel = useMemo(
    () => formatDateFilterLabel(lastUpdatedRange),
    [lastUpdatedRange],
  );
  const lastUpdatedFilterActive = isDateRangeActive(lastUpdatedRange);
  const dateFilterLabel = useMemo(() => formatDateFilterLabel(dateRange), [dateRange]);
  const dateFilterActive = isDateRangeActive(dateRange);

  const dynamicFieldEntries = useMemo(
    () => buildDynamicFieldFilterEntries(dynamicFields, fieldTypesById),
    [dynamicFields, fieldTypesById],
  );
  const dynamicFieldQueryFilters = useMemo(
    () => toDynamicFieldQueryFilters(dynamicFieldEntries),
    [dynamicFieldEntries],
  );
  const dynamicFieldClientFilters = useMemo(
    () => toDynamicFieldClientFilters(dynamicFieldEntries),
    [dynamicFieldEntries],
  );

  const effectiveAssignedTo = useMemo(() => {
    if (assigneeIds.length > 0) return assigneeIds;
    if (myTicketsOnly && currentUserId) return [currentUserId];
    return [];
  }, [assigneeIds, myTicketsOnly, currentUserId]);

  const { items, isEmpty, isInitialLoading, isMember, hasMore, isLoadingMore, loadMore } =
    useTicketsListData(channelId, {
      assignedTo: effectiveAssignedTo,
      createdBy: createdByIds,
      priority: priorities,
      stageName: stageNames,
      aiCategory: aiCategories,
      ...(tagConversationIds !== undefined ? { conversationIds: tagConversationIds } : {}),
      ...(hasAiDraft ? { hasAiDraft: true } : {}),
      ...(hasSubTickets ? { hasSubTickets: true } : {}),
      userGroups: userGroupIds,
      ...(isLabelFilterAvailable && conversationLabelId ? { conversationLabelId } : {}),
      ...(dynamicFieldQueryFilters ? { dynamicFieldFilters: dynamicFieldQueryFilters } : {}),
      ...(dynamicFieldClientFilters.length ? { dynamicFieldClientFilters } : {}),
      ...(isMailboxDesk ? { mailboxFolder: activeFolder } : {}),
      // x != null              // skips both null and undefined
      // x !== undefined        // skips only undefined; null still passes
      ...(dateRange.start != null ? { createdDateStart: dateRange.start } : {}),
      ...(dateRange.end != null ? { createdDateEnd: dateRange.end } : {}),
      ...(lastUpdatedRange.start != null ? { lastEmailAtStart: lastUpdatedRange.start } : {}),
      ...(lastUpdatedRange.end != null ? { lastEmailAtEnd: lastUpdatedRange.end } : {}),
    });
  const allIds = useMemo(() => items.map(i => i.id), [items]);

  const selection = useTicketsSelection(allIds);
  const search = useTicketsSearchOverlay();
  const assigneeFilter = useTicketsAssigneeFilterOverlay();
  const createdByFilter = useTicketsAssigneeFilterOverlay();
  const stagesFilter = useTicketsFilterOverlay();
  const aiCategoryFilter = useTicketsFilterOverlay();
  const aiTagsFilter = useTicketsFilterOverlay();
  const userGroupsFilter = useTicketsFilterOverlay();
  const labelFilter = useTicketsFilterOverlay();
  const dynamicFieldFilter = useTicketsFilterOverlay();
  const lastUpdatedFilter = useTicketsFilterOverlay();
  const dateFilter = useTicketsFilterOverlay();

  const selectionProgress = useSharedValue(0);
  useEffect(() => {
    selectionProgress.value = withTiming(selection.isSelecting ? 1 : 0, {
      duration: TICKETS_SELECTION_FADE_MS,
    });
  }, [selection.isSelecting, selectionProgress]);

  const openFilterPicker = useCallback(
    (pending: PendingFilter) => {
      switch (pending.kind) {
        case 'myTickets':
        case 'hasAiDraft':
        case 'hasSubTickets':
          return;
        case 'assignee':
          assigneeFilter.open();
          return;
        case 'createdBy':
          createdByFilter.open();
          return;
        case 'priority':
          setPrioritySheetOpen(true);
          return;
        case 'stages':
          stagesFilter.open();
          return;
        case 'aiCategory':
          aiCategoryFilter.open();
          return;
        case 'aiTags':
          aiTagsFilter.open();
          return;
        case 'userGroups':
          userGroupsFilter.open();
          return;
        case 'label':
          labelFilter.open();
          return;
        case 'dynamicField':
          setActiveDynamicFieldId(pending.fieldId ?? null);
          dynamicFieldFilter.open();
          return;
        case 'lastUpdated':
          lastUpdatedFilter.open();
          return;
        case 'date':
          dateFilter.open();
          return;
      }
    },
    [
      assigneeFilter,
      createdByFilter,
      stagesFilter,
      aiCategoryFilter,
      aiTagsFilter,
      userGroupsFilter,
      labelFilter,
      dynamicFieldFilter,
      lastUpdatedFilter,
      dateFilter,
    ],
  );

  const closeOtherOverlays = useCallback(
    (
      except?:
        | 'assignee'
        | 'createdBy'
        | 'priority'
        | 'stages'
        | 'aiCategory'
        | 'aiTags'
        | 'userGroups'
        | 'label'
        | 'dynamicField'
        | 'lastUpdated'
        | 'date'
        | 'filtersDrawer',
    ) => {
      if (except !== 'filtersDrawer' && filtersDrawerOpen) {
        pendingFilterRef.current = null;
        setFiltersDrawerOpen(false);
      }
      if (except !== 'priority' && prioritySheetOpen) setPrioritySheetOpen(false);
      if (except !== 'assignee' && assigneeFilter.isOpen) assigneeFilter.close();
      if (except !== 'createdBy' && createdByFilter.isOpen) createdByFilter.close();
      if (except !== 'stages' && stagesFilter.isOpen) stagesFilter.close();
      if (except !== 'aiCategory' && aiCategoryFilter.isOpen) aiCategoryFilter.close();
      if (except !== 'aiTags' && aiTagsFilter.isOpen) aiTagsFilter.close();
      if (except !== 'userGroups' && userGroupsFilter.isOpen) userGroupsFilter.close();
      if (except !== 'label' && labelFilter.isOpen) labelFilter.close();
      if (except !== 'dynamicField' && dynamicFieldFilter.isOpen) {
        dynamicFieldFilter.close();
        setActiveDynamicFieldId(null);
      }
      if (except !== 'lastUpdated' && lastUpdatedFilter.isOpen) lastUpdatedFilter.close();
      if (except !== 'date' && dateFilter.isOpen) dateFilter.close();
    },
    [
      filtersDrawerOpen,
      prioritySheetOpen,
      assigneeFilter.isOpen,
      assigneeFilter.close,
      createdByFilter.isOpen,
      createdByFilter.close,
      stagesFilter.isOpen,
      stagesFilter.close,
      aiCategoryFilter.isOpen,
      aiCategoryFilter.close,
      aiTagsFilter.isOpen,
      aiTagsFilter.close,
      userGroupsFilter.isOpen,
      userGroupsFilter.close,
      labelFilter.isOpen,
      labelFilter.close,
      dynamicFieldFilter.isOpen,
      dynamicFieldFilter.close,
      lastUpdatedFilter.isOpen,
      lastUpdatedFilter.close,
      dateFilter.isOpen,
      dateFilter.close,
    ],
  );

  const dismissOverlayOrGoBack = useCallback(() => {
    pendingFilterRef.current = null;
    if (filtersDrawerOpen) {
      setFiltersDrawerOpen(false);
      return true;
    }
    if (prioritySheetOpen) {
      setPrioritySheetOpen(false);
      return true;
    }
    if (assigneeFilter.isOpen) {
      assigneeFilter.close();
      return true;
    }
    if (createdByFilter.isOpen) {
      createdByFilter.close();
      return true;
    }
    if (stagesFilter.isOpen) {
      stagesFilter.close();
      return true;
    }
    if (aiCategoryFilter.isOpen) {
      aiCategoryFilter.close();
      return true;
    }
    if (aiTagsFilter.isOpen) {
      aiTagsFilter.close();
      return true;
    }
    if (userGroupsFilter.isOpen) {
      userGroupsFilter.close();
      return true;
    }
    if (labelFilter.isOpen) {
      labelFilter.close();
      return true;
    }
    if (dynamicFieldFilter.isOpen) {
      dynamicFieldFilter.close();
      setActiveDynamicFieldId(null);
      return true;
    }
    if (lastUpdatedFilter.isOpen) {
      lastUpdatedFilter.close();
      return true;
    }
    if (dateFilter.isOpen) {
      dateFilter.close();
      return true;
    }
    if (search.isOpen) {
      search.close();
      return true;
    }
    if (selection.isSelecting) {
      selection.clearSelection();
      return true;
    }
    return false;
  }, [
    filtersDrawerOpen,
    prioritySheetOpen,
    assigneeFilter.isOpen,
    assigneeFilter.close,
    createdByFilter.isOpen,
    createdByFilter.close,
    stagesFilter.isOpen,
    stagesFilter.close,
    aiCategoryFilter.isOpen,
    aiCategoryFilter.close,
    aiTagsFilter.isOpen,
    aiTagsFilter.close,
    userGroupsFilter.isOpen,
    userGroupsFilter.close,
    labelFilter.isOpen,
    labelFilter.close,
    dynamicFieldFilter.isOpen,
    dynamicFieldFilter.close,
    lastUpdatedFilter.isOpen,
    lastUpdatedFilter.close,
    dateFilter.isOpen,
    dateFilter.close,
    search.isOpen,
    search.close,
    selection.isSelecting,
    selection.clearSelection,
  ]);

  const blockingOverlayOpen =
    filtersDrawerOpen ||
    prioritySheetOpen ||
    assigneeFilter.isOpen ||
    createdByFilter.isOpen ||
    stagesFilter.isOpen ||
    aiCategoryFilter.isOpen ||
    aiTagsFilter.isOpen ||
    userGroupsFilter.isOpen ||
    labelFilter.isOpen ||
    dynamicFieldFilter.isOpen ||
    lastUpdatedFilter.isOpen ||
    dateFilter.isOpen ||
    search.isOpen ||
    selection.isSelecting;

  usePreventRemove(blockingOverlayOpen, () => {
    dismissOverlayOrGoBack();
  });

  useEffect(() => {
    if (!blockingOverlayOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () =>
      dismissOverlayOrGoBack(),
    );
    return () => {
      subscription.remove();
    };
  }, [blockingOverlayOpen, dismissOverlayOrGoBack]);

  const openSearch = useCallback(() => {
    if (selection.isSelecting) selection.clearSelection();
    closeOtherOverlays();
    search.open();
  }, [selection.isSelecting, selection.clearSelection, closeOtherOverlays, search.open]);

  const openFiltersDrawer = useCallback(() => {
    if (selection.isSelecting) selection.clearSelection();
    if (search.isOpen) search.close();
    closeOtherOverlays('filtersDrawer');
    pendingFilterRef.current = null;
    setFiltersDrawerOpen(true);
  }, [
    selection.isSelecting,
    selection.clearSelection,
    search.isOpen,
    search.close,
    closeOtherOverlays,
  ]);

  const handleFiltersDrawerOpenChange = useCallback(
    (open: boolean) => {
      setFiltersDrawerOpen(open);
      if (open) return;
      const pending = pendingFilterRef.current;
      pendingFilterRef.current = null;
      if (pending) openFilterPicker(pending);
    },
    [openFilterPicker],
  );

  const selectFromFiltersDrawer = useCallback((item: TicketsFilterDrawerItem) => {
    if (item.variant === 'toggle') return;
    pendingFilterRef.current = { kind: item.kind, fieldId: item.fieldId };
    setFiltersDrawerOpen(false);
  }, []);

  const toggleFromFiltersDrawer = useCallback(
    (kind: TicketsFilterDrawerToggleKind, next: boolean) => {
      if (kind === 'myTickets') {
        setMyTicketsOnly(next);
        if (next) setAssigneeIds([]);
        return;
      }
      if (kind === 'hasAiDraft') {
        setHasAiDraft(next);
        return;
      }
      setHasSubTickets(next);
    },
    [],
  );

  const handleSelectFolder = useCallback((folder: TicketMailboxFolder) => {
    setActiveFolder(folder);
  }, []);

  const applyAfterClose = useCallback((close: () => void, apply: () => void) => {
    close();
    requestAnimationFrame(apply);
  }, []);

  const handleAssigneeApply = useCallback(
    (userIds: string[]) => {
      applyAfterClose(assigneeFilter.close, () => {
        setAssigneeIds(userIds);
        if (userIds.length > 0) setMyTicketsOnly(false);
      });
    },
    [applyAfterClose, assigneeFilter.close],
  );

  const handleCreatedByApply = useCallback(
    (userIds: string[]) => {
      applyAfterClose(createdByFilter.close, () => setCreatedByIds(userIds));
    },
    [applyAfterClose, createdByFilter.close],
  );

  const handleStagesApply = useCallback(
    (names: string[]) => {
      applyAfterClose(stagesFilter.close, () => setStageNames(names));
    },
    [applyAfterClose, stagesFilter.close],
  );

  const handleAiCategoryApply = useCallback(
    (categories: string[]) => {
      applyAfterClose(aiCategoryFilter.close, () => setAiCategories(categories));
    },
    [applyAfterClose, aiCategoryFilter.close],
  );

  const handleAiTagsApply = useCallback(
    (tags: string[]) => {
      applyAfterClose(aiTagsFilter.close, () => setGeneratedTags(tags));
    },
    [applyAfterClose, aiTagsFilter.close],
  );

  const handleUserGroupsApply = useCallback(
    (groupIds: string[]) => {
      applyAfterClose(userGroupsFilter.close, () => setUserGroupIds(groupIds));
    },
    [applyAfterClose, userGroupsFilter.close],
  );

  const handleLabelApply = useCallback(
    (ids: string[]) => {
      applyAfterClose(labelFilter.close, () => {
        setConversationLabelId(resolveConversationLabelId(ids));
      });
    },
    [applyAfterClose, labelFilter.close],
  );

  const handleDynamicFieldApply = useCallback(
    (values: string[]) => {
      const fieldId = activeDynamicFieldId;
      applyAfterClose(dynamicFieldFilter.close, () => {
        setActiveDynamicFieldId(null);
        if (!fieldId) return;
        setDynamicFields(prev => {
          const next = { ...prev };
          if (values.length === 0) delete next[fieldId];
          else next[fieldId] = values;
          return next;
        });
      });
    },
    [activeDynamicFieldId, applyAfterClose, dynamicFieldFilter.close],
  );

  const handleLastUpdatedApply = useCallback(
    (range: TicketsDateRange) => {
      applyAfterClose(lastUpdatedFilter.close, () => setLastUpdatedRange(range));
    },
    [applyAfterClose, lastUpdatedFilter.close],
  );

  const handleDateApply = useCallback(
    (range: TicketsDateRange) => {
      applyAfterClose(dateFilter.close, () => setDateRange(range));
    },
    [applyAfterClose, dateFilter.close],
  );

  const handleTogglePriority = useCallback((priority: TicketPriority) => {
    setPrioritySheetOpen(false);
    requestAnimationFrame(() => {
      setPriorities(prev =>
        prev.includes(priority) ? prev.filter(p => p !== priority) : [...prev, priority],
      );
    });
  }, []);

  const handleHeaderBack = () => {
    if (dismissOverlayOrGoBack()) return;
    router.back();
  };

  const showComposeFab =
    isMember && isMailboxDesk && !selection.isSelecting && !search.isOpen && !filtersDrawerOpen;

  const handleCompose = useCallback(() => {
    if (!channelId) return;
    router.push({
      pathname: '/xyne-desks/[channelId]/compose',
      params: { channelId },
    });
  }, [channelId, router]);

  const hasActiveFilters =
    myTicketsOnly ||
    assigneeIds.length > 0 ||
    createdByIds.length > 0 ||
    priorities.length > 0 ||
    stageNames.length > 0 ||
    hasAiDraft ||
    hasSubTickets ||
    aiCategories.length > 0 ||
    generatedTags.length > 0 ||
    userGroupIds.length > 0 ||
    Boolean(conversationLabelId) ||
    Object.keys(dynamicFields).length > 0 ||
    lastUpdatedFilterActive ||
    dateFilterActive;

  const activeDynamicField = useMemo(
    () => dynamicFieldDefs.find(f => f.id === activeDynamicFieldId) ?? null,
    [dynamicFieldDefs, activeDynamicFieldId],
  );

  const dynamicFieldOptions = useMemo(() => {
    if (!activeDynamicField) return [];
    if (activeDynamicField.fieldType === FormFieldType.BOOLEAN) {
      return [
        { id: 'true', label: 'True' },
        { id: 'false', label: 'False' },
      ];
    }
    return activeDynamicField.fieldEnum.map(value => ({ id: value, label: value }));
  }, [activeDynamicField]);

  const dynamicFieldSelectedIds = useMemo(() => {
    if (!activeDynamicFieldId) return [];
    const value = dynamicFields[activeDynamicFieldId];
    return Array.isArray(value) ? value : [];
  }, [activeDynamicFieldId, dynamicFields]);

  const drawerItems = useMemo<TicketsFilterDrawerItem[]>(() => {
    const items: TicketsFilterDrawerItem[] = [
      {
        kind: 'myTickets',
        label: 'My tickets',
        value: 'On',
        isActive: myTicketsOnly,
        variant: 'toggle',
      },
      {
        kind: 'assignee',
        label: 'Assignee',
        value: assigneeFilterLabel,
        isActive: assigneeIds.length > 0,
      },
      {
        kind: 'priority',
        label: 'Priority',
        value: priorityFilterLabel,
        isActive: priorities.length > 0,
      },
      {
        kind: 'stages',
        label: 'Status',
        value: stageFilterLabel,
        isActive: stageNames.length > 0,
      },
      {
        kind: 'hasAiDraft',
        label: 'AI draft',
        value: 'On',
        isActive: hasAiDraft,
        variant: 'toggle',
      },
      {
        kind: 'hasSubTickets',
        label: 'Has sub-tickets',
        value: 'On',
        isActive: hasSubTickets,
        variant: 'toggle',
      },
      {
        kind: 'aiCategory',
        label: 'AI Category',
        value: aiCategoryFilterLabel,
        isActive: aiCategories.length > 0,
      },
      {
        kind: 'aiTags',
        label: 'AI Tags',
        value: aiTagsFilterLabel,
        isActive: generatedTags.length > 0,
      },
      {
        kind: 'userGroups',
        label: 'User Groups',
        value: userGroupFilterLabel,
        isActive: userGroupIds.length > 0,
      },
      {
        kind: 'createdBy',
        label: 'Created by',
        value: createdByFilterLabel,
        isActive: createdByIds.length > 0,
      },
      ...(isLabelFilterAvailable
        ? [
            {
              kind: 'label' as const,
              label: 'Label',
              value: labelFilterLabel,
              isActive: Boolean(conversationLabelId),
            },
          ]
        : []),
      {
        kind: 'lastUpdated',
        label: 'Last updated',
        value: lastUpdatedFilterLabel,
        isActive: lastUpdatedFilterActive,
      },
      {
        kind: 'date',
        label: 'Created at',
        value: dateFilterLabel,
        isActive: dateFilterActive,
      },
    ];

    for (const field of dynamicFieldDefs) {
      const value = dynamicFields[field.id];
      const selected = Array.isArray(value) ? value : [];
      items.push({
        kind: 'dynamicField',
        fieldId: field.id,
        label: field.name,
        value: formatMultiSelectFilterLabel(selected, field.name),
        isActive: selected.length > 0,
      });
    }

    return items;
  }, [
    myTicketsOnly,
    assigneeFilterLabel,
    assigneeIds.length,
    priorityFilterLabel,
    priorities.length,
    stageFilterLabel,
    stageNames.length,
    hasAiDraft,
    hasSubTickets,
    aiCategoryFilterLabel,
    aiCategories.length,
    aiTagsFilterLabel,
    generatedTags.length,
    userGroupFilterLabel,
    userGroupIds.length,
    createdByFilterLabel,
    createdByIds.length,
    isLabelFilterAvailable,
    labelFilterLabel,
    conversationLabelId,
    lastUpdatedFilterLabel,
    lastUpdatedFilterActive,
    dateFilterLabel,
    dateFilterActive,
    dynamicFieldDefs,
    dynamicFields,
  ]);

  const mailboxEmptyCopy = useMemo(() => {
    if (!isMailboxDesk) return null;
    switch (activeFolder) {
      case 'starred':
        return {
          title: 'No starred tickets',
          subtitle: 'Star a ticket to find it here later.',
        };
      case 'spam':
        return { title: 'Spam is empty', subtitle: 'Tickets marked as spam will show up here.' };
      case 'drafts':
        return { title: 'No drafts', subtitle: 'Saved reply drafts for tickets appear here.' };
      case 'sent':
        return { title: 'No sent mail', subtitle: 'Tickets you’ve replied to appear here.' };
      case 'all':
        return {
          title: 'No mail',
          subtitle: 'All non-spam tickets for this desk will show up here.',
        };
      case 'inbox':
      default:
        return null;
    }
  }, [isMailboxDesk, activeFolder]);

  return (
    <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
      <TicketsList
        items={items}
        isEmpty={isEmpty}
        isInitialLoading={isInitialLoading}
        activeFolder={activeFolder}
        showMailboxFolders={isMailboxDesk}
        isSelecting={selection.isSelecting}
        allSelected={selection.allSelected}
        selectedIds={selection.selectedIds}
        hasActiveFilters={hasActiveFilters}
        emptyTitle={mailboxEmptyCopy?.title}
        emptySubtitle={mailboxEmptyCopy?.subtitle}
        onSelectFolder={handleSelectFolder}
        onToggleSelect={selection.toggleId}
        onEnterSelection={selection.enterSelection}
        onToggleSelectAll={selection.toggleSelectAll}
        extraBottomPadding={showComposeFab ? 88 : 0}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMore}
      />

      <TicketsListHeader
        channelName={channelName}
        isSelecting={selection.isSelecting}
        selectedCount={selection.selectedCount}
        hasActiveFilters={hasActiveFilters}
        selectionProgress={selectionProgress}
        searchProgress={search.progress}
        onBack={handleHeaderBack}
        onOpenSearch={openSearch}
        onOpenFilters={openFiltersDrawer}
        onExitSelection={selection.clearSelection}
        onArchive={() => {}}
        onDelete={() => {}}
        onToggleRead={() => {}}
        onMore={() => {}}
      />

      <TicketsFilterDrawer
        isOpen={filtersDrawerOpen}
        items={drawerItems}
        hasActiveFilters={hasActiveFilters}
        onOpenChange={handleFiltersDrawerOpenChange}
        onSelect={selectFromFiltersDrawer}
        onToggle={toggleFromFiltersDrawer}
        onClearAll={clearAllFilters}
      />

      {search.isMounted ? (
        <TicketsSearchOverlay
          progress={search.progress}
          isOpen={search.isOpen}
          channelId={channelId}
          channelName={channelName}
          onClose={search.close}
        />
      ) : null}

      {assigneeFilter.isMounted ? (
        <TicketsAssigneeFilterOverlay
          progress={assigneeFilter.progress}
          isOpen={assigneeFilter.isOpen}
          title='Assignee'
          selectedIds={assigneeIds}
          onClose={assigneeFilter.close}
          onApply={handleAssigneeApply}
        />
      ) : null}

      {createdByFilter.isMounted ? (
        <TicketsAssigneeFilterOverlay
          progress={createdByFilter.progress}
          isOpen={createdByFilter.isOpen}
          title='Created by'
          selectedIds={createdByIds}
          onClose={createdByFilter.close}
          onApply={handleCreatedByApply}
        />
      ) : null}

      {stagesFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={stagesFilter.progress}
          isOpen={stagesFilter.isOpen}
          title='Stages'
          searchPlaceholder='Search stages...'
          emptyLabel='No stages available'
          selectedIds={stageNames}
          options={stageOptions}
          onClose={stagesFilter.close}
          onApply={handleStagesApply}
        />
      ) : null}

      {aiCategoryFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={aiCategoryFilter.progress}
          isOpen={aiCategoryFilter.isOpen}
          title='AI Category'
          searchPlaceholder='Search categories...'
          emptyLabel='No categories available'
          selectedIds={aiCategories}
          options={aiCategoryOptions}
          onClose={aiCategoryFilter.close}
          onApply={handleAiCategoryApply}
        />
      ) : null}

      {aiTagsFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={aiTagsFilter.progress}
          isOpen={aiTagsFilter.isOpen}
          title='AI Tags'
          searchPlaceholder='Search tags...'
          emptyLabel='No tags available'
          selectedIds={generatedTags}
          options={aiTagsOptions}
          onClose={aiTagsFilter.close}
          onApply={handleAiTagsApply}
        />
      ) : null}

      {userGroupsFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={userGroupsFilter.progress}
          isOpen={userGroupsFilter.isOpen}
          title='User Groups'
          searchPlaceholder='Search user groups...'
          emptyLabel='No user groups available'
          selectedIds={userGroupIds}
          options={userGroupOptions}
          onClose={userGroupsFilter.close}
          onApply={handleUserGroupsApply}
          defaultLimit={20}
          searchLimit={20}
        />
      ) : null}

      {isLabelFilterAvailable && labelFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={labelFilter.progress}
          isOpen={labelFilter.isOpen}
          title='Label'
          searchPlaceholder='Search labels...'
          emptyLabel='No labels available'
          selectedIds={conversationLabelId ? [conversationLabelId] : []}
          options={labelOptions}
          selectionMode='single'
          onClose={labelFilter.close}
          onApply={handleLabelApply}
        />
      ) : null}

      {dynamicFieldFilter.isMounted ? (
        <TicketsMultiSelectFilterOverlay
          progress={dynamicFieldFilter.progress}
          isOpen={dynamicFieldFilter.isOpen}
          title={activeDynamicField?.name ?? 'Custom field'}
          searchPlaceholder='Search values...'
          emptyLabel='No values available'
          selectedIds={dynamicFieldSelectedIds}
          options={dynamicFieldOptions}
          onClose={() => {
            dynamicFieldFilter.close();
            setActiveDynamicFieldId(null);
          }}
          onApply={handleDynamicFieldApply}
        />
      ) : null}

      {lastUpdatedFilter.isMounted ? (
        <TicketsDateFilterOverlay
          progress={lastUpdatedFilter.progress}
          isOpen={lastUpdatedFilter.isOpen}
          title='Last updated'
          dateRange={lastUpdatedRange}
          onClose={lastUpdatedFilter.close}
          onApply={handleLastUpdatedApply}
        />
      ) : null}

      {dateFilter.isMounted ? (
        <TicketsDateFilterOverlay
          progress={dateFilter.progress}
          isOpen={dateFilter.isOpen}
          title='Created at'
          dateRange={dateRange}
          onClose={dateFilter.close}
          onApply={handleDateApply}
        />
      ) : null}

      <TicketsPriorityFilterSheet
        isOpen={prioritySheetOpen}
        selectedPriorities={priorities}
        onOpenChange={setPrioritySheetOpen}
        onTogglePriority={handleTogglePriority}
      />

      {showComposeFab ? <TicketsComposeFab onPress={handleCompose} /> : null}
    </View>
  );
}
