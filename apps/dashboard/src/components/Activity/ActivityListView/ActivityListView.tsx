import {
  ComponentType,
  ReactElement,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import { ActivityItem } from '../ActivityItem';
import { NofocusRefProvider } from '../ActivityItemCard';
import { GroupedTicketActivity } from '../GroupedTicketActivity';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { cn } from '../../../utils/classNames';
import type { ActivityWithRelated } from '../../../types/activity';
import { ActivityClassification, UserType } from '@xyne/shared';
import { Bot, UserUser02 } from '@xyne/icons';
import { groupActivities, type ActivityFeedItem } from '../activityGrouping';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Skeleton } from '../../ui/Skeleton';
import { useShortcut } from '../../../shortcuts';
import { extractUserMentions } from '../../../utils/mentionParser';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../../ui/Resizable/Resizable';
import {
  ACTIVITY_SIDEBAR_DEFAULT_WIDTH,
  ACTIVITY_SIDEBAR_MAX_WIDTH,
  ACTIVITY_SIDEBAR_MIN_WIDTH,
} from './activitySidebarWidth';
import { usePlatform } from '../../../hooks/usePlatform';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { logger, Event } from '../../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../../services/otel';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import AppNavigator from '../../AppNavigator/AppNavigator';
import {
  MarkAsRead,
  ThreeDotsMenuVertical,
  AtMark,
  TicketToken,
  File02Text,
  FaceSmile,
  UserTwo,
  CheckTickCircleBroken,
  InformationCircle,
  ArrowTurnUpLeft,
  PhoneDefault,
  AlignVerticalCenter,
  SpatialScreen,
  NotificationBellOn,
} from '@xyne/icons';
import { Tooltip } from '../../ui/Tooltip/Tooltip';

type ActivityTab =
  | 'all'
  | 'your_mentions'
  | 'replies'
  | 'reactions'
  | 'tickets'
  | 'canvas'
  | 'calls'
  | 'actionable'
  | 'fyi'
  | 'group_mentions';

type TabConfig = {
  value: ActivityTab;
  label: string;
  // Widened from LucideIcon so both lucide and @xyne/icons (Pika) components
  // fit — the render site only ever passes className.
  Icon?: ComponentType<{ className?: string }>;
  filter: (activity: ActivityWithRelated) => boolean;
};

type ActivityCursor = NonNullable<Parameters<typeof queries.userActivitiesPaginatedV2>[0]['start']>;

const isAllVisibleActivity = (activity: ActivityWithRelated): boolean => {
  const classification = activity.classification ?? ActivityClassification.PENDING;
  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
    return false;
  }

  if (classification === ActivityClassification.SKIP) return false;
  if (activity.actorAction === 'direct_message') {
    return (
      classification === ActivityClassification.ACTIONABLE ||
      classification === ActivityClassification.FYI
    );
  }
  return true;
};

const CALL_ACTIVITY_TYPES = [
  'scheduled_call',
  'call_reminder',
  'call_updated',
  'meeting_accepted',
  'meeting_declined',
] as const;

const isCallActivity = (activity: ActivityWithRelated): boolean =>
  CALL_ACTIVITY_TYPES.some(type => type === activity.actorAction);

export const isDirectUserMention = (messageContent: string, userId: string): boolean => {
  const userMentions = extractUserMentions(messageContent);
  return userMentions.includes(userId);
};

type ActorFilter = 'all' | 'user' | 'agent';

// Agent covers both automated actor kinds; only USER is a human. `all` maps to
// undefined so the query drops the actor filter entirely rather than matching
// every type — the three orphan rows have an actorId that resolves to no user.
const ACTOR_FILTER_TYPES: Record<ActorFilter, UserType[] | undefined> = {
  all: undefined,
  user: [UserType.USER],
  agent: [UserType.BOT, UserType.APP],
};

const ACTOR_FILTER_OPTIONS: Array<{
  value: ActorFilter;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}> = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'User', icon: UserUser02 },
  { value: 'agent', label: 'Agent', icon: Bot },
];

const TABS: TabConfig[] = [
  { value: 'all', label: 'All', filter: isAllVisibleActivity },
  {
    value: 'your_mentions',
    label: 'Your Mentions',
    Icon: AtMark,
    filter: activity => activity.actorAction === 'mentioned_user',
  },
  {
    value: 'replies',
    label: 'Replies',
    Icon: ArrowTurnUpLeft,
    // added to maintain backward compat for now, to be deprecated
    filter: activity => activity.actorAction === 'replied' || activity.actorAction === 'replied_v2',
  },
  {
    value: 'reactions',
    label: 'Reactions',
    Icon: FaceSmile,
    // added to maintain backward compat for now, to be deprecated
    filter: activity =>
      activity.actorAction === 'added' ||
      activity.actorAction === 'added_v2' ||
      activity.actorAction === 'removed',
  },
  {
    value: 'tickets',
    label: 'Tickets',
    Icon: TicketToken,
    filter: activity =>
      activity.actorAction === 'eta_warning' ||
      activity.actorAction === 'eta_breach' ||
      activity.actorAction === 'stage_eta_breach' ||
      activity.ticketId !== null,
  },
  {
    value: 'canvas',
    label: 'Canvas',
    Icon: File02Text,
    filter: activity =>
      activity.actorAction === 'canvas_shared' ||
      activity.actorAction === 'canvas_role_changed' ||
      activity.actorAction === 'canvas_access_revoked' ||
      (activity.actorAction === 'mentioned_user' && !!activity.canvasId),
  },
  {
    value: 'calls',
    label: 'Calls',
    Icon: PhoneDefault,
    filter: isCallActivity,
  },
  {
    value: 'group_mentions',
    label: 'Group Mentions',
    Icon: UserTwo,
    filter: activity => activity.actorAction === 'group_mention',
  },
  {
    value: 'actionable',
    label: 'Actionable',
    Icon: CheckTickCircleBroken,
    filter: (activity): boolean => {
      const classification = activity.classification ?? ActivityClassification.PENDING;
      return classification === ActivityClassification.ACTIONABLE;
    },
  },
  {
    value: 'fyi',
    label: 'FYI',
    Icon: InformationCircle,
    filter: (activity): boolean => {
      const classification = activity.classification ?? ActivityClassification.PENDING;
      return classification === ActivityClassification.FYI;
    },
  },
];

const actionableValues = new Set<ActivityTab>(['actionable', 'fyi']);

const ActivityListView = (): ReactElement => {
  const { isMobile } = usePlatform();
  const location = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const pathWithoutWorkspace = workspaceId
    ? location.pathname.slice(`/${workspaceId}`.length)
    : location.pathname;
  const isOnIndexRoute = pathWithoutWorkspace === '/chat/activity';

  const activityPanelRef = useRef<PanelImperativeHandle>(null);
  const activityVirtuosoRef = useRef<VirtuosoHandle>(null);

  // All hooks must be called before any conditional returns
  const [activeTab, setActiveTab] = useState<ActivityTab>('all');
  const [actorFilter, setActorFilter] = useState<ActorFilter>(() => {
    const stored = window.localStorage.getItem('activity_actor_filter');
    return stored === 'all' || stored === 'user' || stored === 'agent' ? stored : 'all';
  });

  const [showUnreadOnly, setShowUnreadOnly] = useState<boolean>(() => {
    const unread = window.localStorage.getItem('activity_unread_toggle');
    return unread === 'true';
  });
  const [active, setActive] = useState<'condensed' | 'detailed'>(() => {
    const viewMode = window.localStorage.getItem('activity_view_mode');
    return viewMode === 'detailed' ? 'detailed' : 'condensed';
  });
  const [actionableToggle, setActionableToggle] = useState<boolean>(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const zero = useZero();

  useEffect(() => {
    const stored = window.localStorage.getItem('activity_actionable_toggle');
    const nextValue = stored === null ? true : stored === 'true';
    setActionableToggle(nextValue);
  }, []);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setShowMobileMenu(false);
      }
    };

    if (showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMobileMenu]);

  const showActionableTabs = actionableToggle;

  useEffect(() => {
    const isActionableTab = actionableValues.has(activeTab);
    if (showActionableTabs) {
      if (!isActionableTab && activeTab !== 'all') {
        setActiveTab('all');
      }
      return;
    }
    if (isActionableTab) {
      setActiveTab('all');
    }
  }, [showActionableTabs, activeTab]);

  const handleTabChange = useCallback(
    (value: string): void => {
      setActiveTab(value as ActivityTab);
    },
    [showUnreadOnly],
  );

  const handleUnreadToggle = useCallback((checked: boolean): void => {
    setShowUnreadOnly(checked);
    window.localStorage.setItem('activity_unread_toggle', String(checked));
    activityVirtuosoRef.current?.scrollToIndex({ index: 0, align: 'start', behavior: 'auto' });
  }, []);

  const handleActorFilterChange = useCallback((next: ActorFilter): void => {
    setActorFilter(next);
    window.localStorage.setItem('activity_actor_filter', next);
  }, []);

  const handleActionableToggle = useCallback((checked: boolean): void => {
    setActionableToggle(checked);
    window.localStorage.setItem('activity_actionable_toggle', String(checked));
  }, []);

  const handleViewModeChange = useCallback((mode: 'condensed' | 'detailed'): void => {
    setActive(mode);
    window.localStorage.setItem('activity_view_mode', mode);
  }, []);

  const visibleTabs = useMemo(() => {
    return TABS.filter(tab =>
      tab.value === 'all'
        ? true
        : showActionableTabs
          ? actionableValues.has(tab.value)
          : !actionableValues.has(tab.value),
    );
  }, [showActionableTabs]);

  const getActivityTypes = (tab: ActivityTab): string[] => {
    switch (tab) {
      case 'your_mentions':
        return ['mentioned_user'];
      case 'replies':
        return ['replied', 'replied_v2'];
      case 'reactions':
        return ['added', 'added_v2', 'removed'];
      case 'group_mentions':
        return ['group_mention'];
      case 'tickets':
        return [
          'eta_warning',
          'eta_breach',
          'stage_eta_breach',
          'ticket_assigned',
          'ticket_status',
          'ticket_eta',
          'ticket_board',
          'ticket_assigned_to',
          'ticket_pr_created',
          'ticket_pr_updated',
          'ticket_pr_merged',
          'ticket_pr_declined',
          'ticket_pr_reviewer_assigned',
          'ticket_qa_assigned',
          'ticket_release_started',
          'ticket_release_completed',
          'ticket_release_cancelled',
          'ticket_release_paused',
          'ticket_release_planning',
          'ticket_priority',
          'ticket_user_group',
          'ticket_title',
          'ticket_description',
          'ticket_rca_created',
          'ticket_rca_updated',
          'ticket_subticket_added',
          'ticket_reference_added',
          'ticket_reference_removed',
          'ticket_multi_updated',
          'workflow_question',
          'stage_approval_requested',
          'stage_approval_approved',
          'stage_approval_rejected',
        ];
      case 'canvas':
        return ['canvas_shared', 'canvas_role_changed', 'canvas_access_revoked', 'mentioned_user'];
      case 'calls':
        return [...CALL_ACTIVITY_TYPES];
      default:
        return []; // Empty array for 'all' - query will not filter by type
    }
  };

  const PAGE_SIZE = 100;

  // Accumulation-based state (Infinite Scroll)
  const [activities, setActivities] = useState<ActivityWithRelated[]>([]);
  const [fetchCursor, setFetchCursor] = useState<ActivityCursor | null>(null);
  const [nextCursor, setNextCursor] = useState<ActivityCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const activityLoadStartTimeRef = useRef<number | null>(null);

  // Reset pagination when tab or unread mode changes
  useEffect(() => {
    setActivities([]);
    setFetchCursor(null);
    setNextCursor(null);
    setHasMore(true);
    setIsLoading(true);
    activityLoadStartTimeRef.current = Date.now();
  }, [activeTab, showUnreadOnly, actorFilter]);

  const getClassificationFilter = (tab: ActivityTab): ActivityClassification[] | undefined => {
    switch (tab) {
      case 'actionable':
        return [ActivityClassification.ACTIONABLE];
      case 'fyi':
        return [ActivityClassification.FYI];
      default:
        return undefined;
    }
  };

  const currentTypes = useMemo(() => getActivityTypes(activeTab), [activeTab]);
  const classificationFilter = useMemo(() => getClassificationFilter(activeTab), [activeTab]);

  const activitiesQuery = useMemo(
    () =>
      queries.userActivitiesPaginatedV2({
        limit: PAGE_SIZE,
        start: fetchCursor,
        types: currentTypes,
        classification: classificationFilter,
        ...(showUnreadOnly ? { isRead: false } : {}),
        ...(ACTOR_FILTER_TYPES[actorFilter] ? { actorTypes: ACTOR_FILTER_TYPES[actorFilter] } : {}),
      }),
    [PAGE_SIZE, fetchCursor, currentTypes, classificationFilter, showUnreadOnly, actorFilter],
  );

  const [activitiesPage, activitiesDetails, activitiesMeta] = useCachedQuery(activitiesQuery, {
    cursorEnabled: true,
    includeMeta: fetchCursor === null,
  });

  // Accumulate results when query completes
  useEffect(() => {
    if (activitiesDetails.type !== 'complete') {
      return; // Wait for query to complete before processing
    }

    setIsLoading(false);

    const canAdvancePagination = fetchCursor !== null || activitiesMeta?.source !== 'cache';

    if (activityLoadStartTimeRef.current !== null) {
      const duration = Date.now() - activityLoadStartTimeRef.current;
      logger.info(Event.ACTIVITIES_LOADED, {
        source: 'ActivityListView',
        message: 'Activities loaded',
        durationMs: duration,
        tab: activeTab,
        url: window.location.href,
      });

      safeRecordMetric(() => {
        dataLoadDuration.record(duration, {
          source: 'ActivityListView',
          event: Event.ACTIVITIES_LOADED,
          platform: logger.platformName,
          tab: activeTab,
        });
      });

      activityLoadStartTimeRef.current = null;
    }

    if (activitiesPage.length === 0) {
      if (!canAdvancePagination) return;
      if (fetchCursor === null) {
        if (showUnreadOnly) {
          // Keep only the currently-selected item (white/read styling).
          // Covers "last 1 item clicked", "2 items → click second", and "mark all as read".
          // Previously-selected items that are no longer active are removed here.
          const currentSelectedId = new URLSearchParams(window.location.search).get(
            'selectedActivity',
          );
          setActivities(prev =>
            prev
              .filter(a => a.id === currentSelectedId)
              .map(a => ({ ...a, isRead: true as const })),
          );
        } else {
          setActivities([]);
        }
        setNextCursor(null);
      }
      setHasMore(false);
      return;
    }

    setActivities(prev => {
      if (fetchCursor === null) {
        if (showUnreadOnly) {
          // When the unread toggle is on, keep the currently-selected activity in the
          // list even after it gets marked as read (removed from activitiesPage by the
          // isRead: false filter). It renders with white/read styling and only leaves
          // the list when a different activity is selected (URL param changes).
          const currentSelectedId = new URLSearchParams(window.location.search).get(
            'selectedActivity',
          );
          const newPageIds = new Set(activitiesPage.map(a => a.id));
          const keptSelected = prev
            .filter(a => !newPageIds.has(a.id) && a.id === currentSelectedId)
            .map(a => ({ ...a, isRead: true as const }));
          if (keptSelected.length > 0) {
            return [...activitiesPage, ...keptSelected].sort(
              (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
            );
          }
        }
        return activitiesPage;
      }

      const combined = [...prev, ...activitiesPage];
      const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
      return unique;
    });

    if (!canAdvancePagination) return;

    setHasMore(activitiesPage.length >= PAGE_SIZE);

    // Store the next cursor but don't fetch yet - wait for handleEndReached
    const lastItemOfPage = activitiesPage[activitiesPage.length - 1];
    if (lastItemOfPage) {
      setNextCursor({
        id: lastItemOfPage.id,
        updatedAt: lastItemOfPage.updatedAt ?? lastItemOfPage.createdAt,
      });
    }
  }, [
    activitiesPage,
    activitiesDetails.type,
    activitiesMeta?.source,
    fetchCursor,
    activeTab,
    showUnreadOnly,
  ]);

  // Scroll down - load older items (triggered ~20-25 items before end via overscan)
  const handleEndReached = useCallback(() => {
    if (!hasMore || isLoading || !nextCursor) return;
    // Trigger the next page fetch
    setIsLoading(true);
    setFetchCursor(nextCursor);
  }, [hasMore, isLoading, nextCursor]);

  const filteredActivities = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    const activeTabConfig = visibleTabs.find(tab => tab.value === activeTab);
    if (!activeTabConfig) {
      return activities;
    }

    return activities.filter(activity => activeTabConfig.filter(activity));
  }, [activities, activeTab, visibleTabs]);

  const groupedActivities = useMemo(() => {
    return groupActivities(filteredActivities);
  }, [filteredActivities]);

  const selectedActivityIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('selectedActivity'),
  );
  const selectedRowElRef = useRef<HTMLElement | null>(null);
  const nofocusRef = useRef(false);

  const stampSelectedRow = useCallback((el: HTMLElement | null): void => {
    const prev = selectedRowElRef.current;
    if (prev === el) return;
    prev?.removeAttribute('data-selected');
    el?.setAttribute('data-selected', 'true');
    selectedRowElRef.current = el;
  }, []);

  const restoreRafRef = useRef<number | null>(null);
  const restoreSelectedRow = useCallback((): void => {
    if (restoreRafRef.current !== null) return;
    restoreRafRef.current = requestAnimationFrame((): void => {
      restoreRafRef.current = null;
      const id = selectedActivityIdRef.current;
      if (!id) return;
      const el = document.querySelector<HTMLElement>(
        `[data-component="ActivityList"] [data-activity-id="${CSS.escape(id)}"]`,
      );
      if (el) stampSelectedRow(el);
    });
  }, [stampSelectedRow]);

  useEffect(() => {
    return (): void => {
      if (restoreRafRef.current !== null) cancelAnimationFrame(restoreRafRef.current);
    };
  }, []);

  const hasActivityRows = groupedActivities.length > 0;

  useEffect(() => {
    if (!hasActivityRows) return;
    const container = document.querySelector('[data-component="ActivityList"]');
    if (!container) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      // Skip selection stamping if the click is on "Mark as read" or "Mark as unread"
      // buttons — those should not highlight the row as "open".
      if (
        target.closest('[data-track-name="MARK_AS_READ"]') ||
        target.closest('[data-track-name="MARK_AS_UNREAD"]')
      ) {
        return;
      }
      const activityEl = target.closest<HTMLElement>('[data-activity-id]');
      const id = activityEl?.getAttribute('data-activity-id');
      if (id && activityEl) {
        selectedActivityIdRef.current = id;
        stampSelectedRow(activityEl);
      }
    };
    container.addEventListener('click', handler, true);
    return () => container.removeEventListener('click', handler, true);
  }, [hasActivityRows, stampSelectedRow]);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('selectedActivity');
    if (!id) return;
    selectedActivityIdRef.current = id;
    restoreSelectedRow();
  }, [location.search, restoreSelectedRow]);

  const navigateActivity = useCallback(
    (delta: number) => {
      const container = document.querySelector('[data-component="ActivityList"]');
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>('[data-activity-id]'));
      if (items.length === 0) return;

      const selectedActivityId = selectedActivityIdRef.current;
      let currentIdx = -1;
      if (selectedActivityId) {
        currentIdx = items.findIndex(
          el => el.getAttribute('data-activity-id') === selectedActivityId,
        );
      }

      const nextIdx =
        currentIdx < 0
          ? delta > 0
            ? 0
            : items.length - 1
          : Math.max(0, Math.min(items.length - 1, currentIdx + delta));
      if (nextIdx === currentIdx && currentIdx >= 0) return;

      const nextEl = items[nextIdx];
      if (!nextEl) return;
      const activityId = nextEl.getAttribute('data-activity-id');
      if (!activityId) return;

      selectedActivityIdRef.current = activityId;
      stampSelectedRow(nextEl);
      nextEl.scrollIntoView({ block: 'nearest' });
      nofocusRef.current = true;
      nextEl.click();
      nofocusRef.current = false;
    },
    [stampSelectedRow],
  );

  useShortcut('j', () => navigateActivity(1), {
    scope: 'global',
    description: 'Next activity',
    category: 'Activity',
    enabled: !isMobile && filteredActivities.length > 0,
  });
  useShortcut('k', () => navigateActivity(-1), {
    scope: 'global',
    description: 'Previous activity',
    category: 'Activity',
    enabled: !isMobile && filteredActivities.length > 0,
  });

  const markActiveTabUnread = () => {
    const filters: {
      actorAction?: string;
      classification?: ActivityClassification;
    } = {};

    if (activeTab === 'your_mentions') {
      filters.actorAction = 'mentioned_user';
    } else if (activeTab === 'group_mentions') {
      filters.actorAction = 'group_mention';
    } else if (activeTab === 'replies') {
      // added to maintain backward compat for now, to be deprecated
      const timestamp = Date.now();
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'replied', timestamp }),
      );
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'replied_v2', timestamp }),
      );
      return;
    } else if (activeTab === 'actionable') {
      filters.classification = ActivityClassification.ACTIONABLE;
    } else if (activeTab === 'fyi') {
      filters.classification = ActivityClassification.FYI;
    } else if (activeTab === 'canvas') {
      const timestamp = Date.now();
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'canvas_shared', timestamp }),
      );
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'canvas_role_changed', timestamp }),
      );
      void zero.mutate(
        mutators.activities.markAsReadByFilter({ actorAction: 'canvas_access_revoked', timestamp }),
      );
      return;
    } else if (activeTab === 'calls') {
      const timestamp = Date.now();
      CALL_ACTIVITY_TYPES.forEach(actorAction => {
        void zero.mutate(mutators.activities.markAsReadByFilter({ actorAction, timestamp }));
      });
      return;
    }

    void zero.mutate(mutators.activities.markAsReadByFilter({ ...filters, timestamp: Date.now() }));
  };
  // Read unread activities from state machine (populated by DeferredLoader)
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  const activityCounts = useMemo(() => {
    const counts: Record<ActivityTab, number> = {
      all: 0,
      your_mentions: 0,
      replies: 0,
      reactions: 0,
      tickets: 0,
      canvas: 0,
      calls: 0,
      actionable: 0,
      fyi: 0,
      group_mentions: 0,
    };

    if (!unreadActivities) {
      return counts;
    }

    unreadActivities.forEach(activity => {
      // 'all' count includes everything visible
      // Cast to ActivityWithRelated since unreadActivities has slightly different shape
      // but isAllVisibleActivity only uses fields that exist in both
      if (isAllVisibleActivity(activity as unknown as ActivityWithRelated)) {
        counts.all++;
      }

      // Check specific tabs
      if (activity.actorAction === 'mentioned_user') {
        counts.your_mentions++;
      } else if (activity.actorAction === 'group_mention') {
        counts.group_mentions++;
      } else if (
        // added to maintain backward compat for now, to be deprecated
        activity.actorAction === 'replied' ||
        activity.actorAction === 'replied_v2'
      ) {
        counts.replies++;
      } else if (
        // added to maintain backward compat for now, to be deprecated
        activity.actorAction === 'added' ||
        activity.actorAction === 'added_v2' ||
        activity.actorAction === 'removed'
      ) {
        counts.reactions++;
      }

      if (
        activity.actorAction === 'canvas_shared' ||
        activity.actorAction === 'canvas_role_changed' ||
        activity.actorAction === 'canvas_access_revoked' ||
        (activity.actorAction === 'mentioned_user' && activity.canvasId)
      ) {
        counts.canvas++;
      }

      if (CALL_ACTIVITY_TYPES.some(type => type === activity.actorAction)) {
        counts.calls++;
      }

      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.ACTIONABLE) {
        counts.actionable++;
      } else if (classification === ActivityClassification.FYI) {
        counts.fyi++;
      }
    });

    return counts;
  }, [unreadActivities]);

  const renderActivityList = (feedItems: ActivityFeedItem[]): ReactElement => {
    const isExpanded = active === 'detailed';

    // Show loading skeleton during initial load
    if (isLoading && feedItems.length === 0) {
      return (
        <div className='flex-1 flex flex-col px-4 py-4 gap-3 overflow-hidden'>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className='flex items-start gap-3 py-2'>
              <Skeleton className='h-8 w-8 rounded-full flex-shrink-0' />
              <div className='flex-1 flex flex-col gap-2 min-w-0'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-4 w-24' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <Skeleton className='h-3 w-full max-w-[300px]' />
                <Skeleton className='h-3 w-3/4' />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (feedItems.length > 0) {
      return (
        <div
          data-component='ActivityList'
          style={{ height: 'calc(100vh - 200px)' }}
          className='relative min-h-0 basis-0 grow flex flex-col'
        >
          <NofocusRefProvider value={nofocusRef}>
            <Virtuoso
              ref={activityVirtuosoRef}
              className='no-scrollbar'
              style={{ height: '100%' }}
              data={feedItems}
              endReached={handleEndReached}
              atTopStateChange={isAtTop => {
                if (isAtTop && fetchCursor !== null) {
                  setFetchCursor(null);
                }
              }}
              computeItemKey={(_, item) =>
                item.type === 'single' ? item.activity.id : `group:${item.activities[0]!.id}`
              }
              increaseViewportBy={1000}
              minOverscanItemCount={{ top: 5, bottom: 10 }}
              components={{ Footer: () => <div className='h-16' aria-hidden='true' /> }}
              itemsRendered={restoreSelectedRow}
              itemContent={(_, item) => {
                // px wraps each row (not the scroller) and pb creates the 8px
                // row gap — padding is used instead of margin so Virtuoso's
                // item measurement includes it.
                return (
                  <div className='px-3 pb-3'>
                    {item.type === 'single' ? (
                      <ActivityItem activity={item.activity} isExpanded={isExpanded} />
                    ) : (
                      <GroupedTicketActivity activities={item.activities} isExpanded={isExpanded} />
                    )}
                  </div>
                );
              }}
            />
          </NofocusRefProvider>
        </div>
      );
    }

    return (
      <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground px-4 py-8'>
        <NotificationBellOn className='w-16 h-16 mb-4' />
        <p className='text-base font-medium'>
          {showUnreadOnly ? 'No unread activities' : 'No activities yet'}
        </p>
        <p className='text-sm mt-1'>
          {showUnreadOnly ? "You're all caught up!" : 'Activities will appear here'}
        </p>
      </div>
    );
  };

  // Render the left panel content (exact same UI)
  const renderLeftPanel = (): ReactElement => (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      {!isMobile && (
        <div className='w-full h-[52px] shrink-0'>
          <AppNavigator />
        </div>
      )}
      <div
        data-id='activity-list-view'
        className={cn(
          'relative flex-1 min-h-0 flex flex-col gap-2 max-w-full overflow-hidden pt-3',
          !isMobile && 'border-t border-sidebar-border-muted',
        )}
      >
        <div className='flex items-center justify-between gap-2 px-3'>
          <div className='flex items-center gap-2'>
            <h2 className='font-bold text-foreground truncate' data-testid='activity-heading'>
              Activity
            </h2>
          </div>
          <div className='flex items-center gap-1'>
            {/* Unread-only filter */}
            <label
              htmlFor='activity-unread-toggle'
              className='flex h-7 items-center gap-2 px-2 rounded-[10px] cursor-pointer select-none transition-colors hover:bg-foreground/[6%]'
            >
              <span className='text-sm font-medium text-muted-foreground'>Unread</span>
              <Switch.Root
                id='activity-unread-toggle'
                checked={showUnreadOnly}
                onCheckedChange={handleUnreadToggle}
                data-track-category='ACTIVITY'
                data-track-name='UNREAD_FILTER_TOGGLE'
                data-track-metadata={JSON.stringify({ filter_value: !showUnreadOnly })}
                data-testid='activity-unread-toggle'
                className={cn(
                  'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full',
                  'bg-sidebar-border transition-colors duration-200',
                  'data-[state=checked]:bg-primary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                )}
              >
                <Switch.Thumb
                  className={cn(
                    'block size-2.5 rounded-full bg-white shadow-sm',
                    'transition-transform duration-200',
                    'translate-x-0.5 data-[state=checked]:translate-x-3',
                  )}
                />
              </Switch.Root>
            </label>

            {/* Agent / User actor filter */}
            <div
              role='radiogroup'
              aria-label='Filter activity by actor'
              className='flex items-center gap-0.5 rounded-xl bg-foreground/[6%] p-0.5'
            >
              {ACTOR_FILTER_OPTIONS.map(option => {
                const isActive = option.value === actorFilter;
                const Icon = option.icon;
                const showLabel = isActive || !Icon;

                return (
                  <button
                    key={option.value}
                    type='button'
                    role='radio'
                    aria-checked={isActive}
                    aria-label={option.label}
                    onClick={() => handleActorFilterChange(option.value)}
                    className={cn(
                      'flex items-center rounded-[10px] pl-2 pr-2.5 py-1',
                      'transition-[background-color,color,box-shadow] duration-300 ease-in-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    data-track-category='ACTIVITY'
                    data-track-name='ACTOR_FILTER_TOGGLE'
                    data-track-metadata={JSON.stringify({ filter_value: option.value })}
                    data-testid={`activity-actor-filter-${option.value}`}
                  >
                    {Icon && <Icon size={14} className='shrink-0' />}
                    <span
                      className={cn(
                        'grid overflow-hidden transition-[grid-template-columns,opacity,margin] duration-300 ease-in-out',
                        Icon ? 'ml-1' : null,
                        showLabel
                          ? 'grid-cols-[1fr] opacity-100'
                          : 'grid-cols-[0fr] opacity-0 ml-0',
                      )}
                    >
                      <span className='min-w-0 overflow-hidden whitespace-nowrap text-xs font-medium tracking-[-0.28px]'>
                        {option.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 3-dot menu with Actionable Toggle and View Toggle (Desktop & Mobile) */}
            <div className='relative' ref={mobileMenuRef}>
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className='p-2 flex items-center justify-center rounded-lg border border-transparent transition-colors text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border'
                aria-label='More options'
                data-track-category='ACTIVITY'
                data-track-name='TOGGLE_MOBILE_MENU'
                data-track-metadata={JSON.stringify({ menuState: !showMobileMenu })}
                data-testid='activity-more-options-btn'
              >
                <ThreeDotsMenuVertical size={16} />
              </button>

              {showMobileMenu && (
                <div className='absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] z-50'>
                  {/* Mark as Read */}
                  <button
                    data-ph-capture-attribute-track-id='mark_tab_as_read'
                    data-ph-capture-attribute-tab={activeTab}
                    onClick={() => {
                      markActiveTabUnread();
                      setShowMobileMenu(false);
                    }}
                    className='w-full px-4 py-2 flex items-center justify-start gap-2 text-sm text-muted-foreground hover:bg-accent transition-colors h-auto'
                    data-track-category='ACTIVITY'
                    data-track-name={`MARK_TAB_READ`}
                    data-track-metadata={JSON.stringify({
                      tab: activeTab,
                      action: 'mark_all_as_read',
                    })}
                    data-testid='activity-mark-as-read-btn'
                  >
                    <MarkAsRead size={16} />
                    <span>Mark as read</span>
                  </button>

                  {/* Divider */}
                  <div className='border-t border-border my-1'></div>

                  {/* Actionable Toggle */}
                  <div className='px-4 py-2 flex items-center justify-between'>
                    <span className='text-sm font-medium text-muted-foreground'>Actionable</span>
                    <Switch.Root
                      checked={actionableToggle}
                      onCheckedChange={handleActionableToggle}
                      data-track-category='ACTIVITY'
                      data-track-name='ACTIONABLE_FILTER_TOGGLE'
                      data-track-metadata={JSON.stringify({
                        filter_value: !actionableToggle,
                      })}
                      data-testid='activity-actionable-toggle'
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full',
                        'bg-sidebar-border transition-colors duration-200',
                        'data-[state=checked]:bg-primary',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      )}
                    >
                      <Switch.Thumb
                        className={cn(
                          'block h-4 w-4 rounded-full bg-white shadow-sm',
                          'transition-transform duration-200',
                          'translate-x-0.5 data-[state=checked]:translate-x-4',
                        )}
                      />
                    </Switch.Root>
                  </div>

                  {/* Divider */}
                  <div className='border-t border-border my-1'></div>

                  {/* Condensed View */}
                  <button
                    onClick={() => {
                      handleViewModeChange('condensed');
                      setShowMobileMenu(false);
                    }}
                    className={cn(
                      'w-full px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:bg-accent transition-colors',
                      active === 'condensed' && 'bg-accent',
                    )}
                    data-track-category='ACTIVITY'
                    data-track-name='CHANGE_VIEW_CONDENSED'
                    data-testid='activity-view-condensed-btn'
                  >
                    <AlignVerticalCenter className='h-4 w-4' />
                    <span>Condensed</span>
                  </button>

                  {/* Detailed View */}
                  <button
                    onClick={() => {
                      handleViewModeChange('detailed');
                      setShowMobileMenu(false);
                    }}
                    className={cn(
                      'w-full px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:bg-accent transition-colors',
                      active === 'detailed' && 'bg-accent',
                    )}
                    data-track-category='ACTIVITY'
                    data-track-name='CHANGE_VIEW_DETAILED'
                    data-testid='activity-view-detailed-btn'
                  >
                    <SpatialScreen className='h-4 w-4' />
                    <span>Detailed</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Tabs.Root
            value={activeTab}
            onValueChange={handleTabChange}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1 }}
          >
            <div className='overflow-x-auto no-scrollbar'>
              <Tabs.List
                className='flex items-center sm:justify-start min-w-max gap-0.5 px-3'
                data-testid='activity-tabs-list'
              >
                {visibleTabs.map(tab => {
                  const count = activityCounts[tab.value];
                  const IconComponent = tab.Icon;
                  const showLabelByDefault =
                    tab.value === 'all' ||
                    isMobile ||
                    showActionableTabs ||
                    activeTab === tab.value;

                  const trigger = (
                    <Tabs.Trigger value={tab.value} asChild>
                      <button
                        aria-label={tab.label}
                        data-track-category='ACTIVITY'
                        data-track-name={`TAB_CHANGE`}
                        data-track-metadata={JSON.stringify({ tab: tab.value })}
                        className={cn(
                          'group px-2 py-2 flex items-center transition-all duration-300 ease-in-out cursor-pointer select-none sm:px-3 justify-start rounded-lg hover:bg-foreground/[6%] focus-visible:bg-foreground/[6%] focus-visible:outline-none',
                          activeTab === tab.value
                            ? 'bg-foreground/[6%]'
                            : 'bg-sidebar-accent-foreground/50',
                        )}
                      >
                        {IconComponent && (
                          <span
                            className={cn(
                              'size-4 flex items-center justify-center shrink-0',
                              activeTab === tab.value
                                ? 'text-sidebar-accent-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            <IconComponent className='w-4 h-4' />
                          </span>
                        )}
                        <span
                          className={cn(
                            'grid overflow-hidden text-xs sm:text-sm font-medium transition-[grid-template-columns,opacity,margin] duration-300 ease-in-out',
                            activeTab === tab.value
                              ? 'text-sidebar-accent-foreground'
                              : 'text-muted-foreground',
                            IconComponent ? 'ml-2' : null,
                            showLabelByDefault
                              ? 'grid-cols-[1fr] opacity-100'
                              : 'grid-cols-[0fr] opacity-0 ml-0',
                          )}
                        >
                          <span className='min-w-0 overflow-hidden whitespace-nowrap text-sm font-medium'>
                            {tab.label}
                          </span>
                        </span>
                        {count > 0 && (
                          <span
                            className={cn(
                              'ml-1.5 shrink-0 text-[0.625rem] px-1 rounded-md font-bold tabular-nums transition-colors',
                              activeTab === tab.value
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                : 'bg-foreground/[6%] text-muted-foreground',
                            )}
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </button>
                    </Tabs.Trigger>
                  );
                  return (
                    <Tooltip key={tab.value} content={tab.label} side='top' delayDuration={500}>
                      {trigger}
                    </Tooltip>
                  );
                })}
              </Tabs.List>
            </div>

            <Tabs.Content
              value={activeTab}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                position: 'relative',
                marginTop: 16,
              }}
              className='focus-visible:outline-none'
            >
              {renderActivityList(groupedActivities)}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );

  // Mobile view - show activity list on index route, detail view otherwise
  if (isMobile) {
    // If on a specific activity route, render the outlet for detail view with white background
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full max-w-full bg-background text-foreground overflow-x-hidden w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show activity list on index route
    return renderLeftPanel();
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full'>
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='activity-screen-resize'
      >
        {/* LEFT PANEL - Activity List */}
        <Panel
          id='activity-sidebar'
          panelRef={activityPanelRef}
          defaultSize={ACTIVITY_SIDEBAR_DEFAULT_WIDTH}
          minSize={ACTIVITY_SIDEBAR_MIN_WIDTH}
          maxSize={ACTIVITY_SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
        >
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'></div>
        </Separator>

        {/* RIGHT PANEL - Detail View */}
        <Panel id='activity-content'>
          <div className='flex-1 flex flex-col bg-background relative h-full rounded-2xl'>
            <div className='flex-1 h-full overflow-hidden flex items-center justify-center'>
              {isOnIndexRoute ? (
                <div className='flex flex-col items-center justify-center p-8 text-center'>
                  <NotificationBellOn className='text-muted-foreground mb-4' size={64} />
                  <h3
                    className='text-xl font-medium text-foreground mb-2'
                    data-testid='select-activity-heading'
                  >
                    Select an activity
                  </h3>
                  <p className='text-muted-foreground max-w-md'>
                    Choose an activity from the list to view its details
                  </p>
                </div>
              ) : (
                <div className='w-full h-full'>
                  <Outlet />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </ResizableGroup>
    </div>
  );
};

export default ActivityListView;
