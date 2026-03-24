import { ReactElement, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import {
  Bell,
  AtSign,
  Smile,
  ArrowLeft,
  LucideIcon,
  CheckCircle,
  Info,
  MessageCircleMore,
  FoldVertical,
  Fullscreen,
  Users,
  Ticket,
  MoreVertical,
} from 'lucide-react';
import { ActivityItem } from '../ActivityItem';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { Badge } from '../../ui/Badge';
import { cn } from '../../../utils/classNames';
import type { ActivityWithRelated } from '../../../types/activity';
import { ActivityClassification } from '@xyne/shared';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { Virtuoso } from 'react-virtuoso';
import { extractUserMentions } from '../../../utils/mentionParser';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { usePlatform } from '../../../hooks/usePlatform';
import { mutators } from '../../../zero/mutators';
import Button from '../../ui/Button';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useQuery } from '../../../hooks/useQuery';
import { logger, Event } from '../../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../../services/otel';

type ActivityTab =
  | 'all'
  | 'your_mentions'
  | 'replies'
  | 'reactions'
  | 'tickets'
  | 'actionable'
  | 'fyi'
  | 'group_mentions';

type TabConfig = {
  value: ActivityTab;
  label: string;
  Icon?: LucideIcon;
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

export const isDirectUserMention = (messageContent: string, userId: string): boolean => {
  const userMentions = extractUserMentions(messageContent);
  return userMentions.includes(userId);
};

const TABS: TabConfig[] = [
  { value: 'all', label: 'All', filter: isAllVisibleActivity },
  {
    value: 'your_mentions',
    label: 'Your Mentions',
    Icon: AtSign,
    filter: activity => activity.actorAction === 'mentioned_user',
  },
  {
    value: 'replies',
    label: 'Replies',
    Icon: MessageCircleMore,
    // added to maintain backward compat for now, to be deprecated
    filter: activity => activity.actorAction === 'replied' || activity.actorAction === 'replied_v2',
  },
  {
    value: 'reactions',
    label: 'Reactions',
    Icon: Smile,
    // added to maintain backward compat for now, to be deprecated
    filter: activity =>
      activity.actorAction === 'added' ||
      activity.actorAction === 'added_v2' ||
      activity.actorAction === 'removed',
  },
  {
    value: 'tickets',
    label: 'Tickets',
    Icon: Ticket,
    filter: activity =>
      activity.actorAction === 'eta_warning' ||
      activity.actorAction === 'eta_breach' ||
      activity.actorAction === 'stage_eta_breach' ||
      activity.ticketId !== null,
  },
  {
    value: 'group_mentions',
    label: 'Group Mentions',
    Icon: Users,
    filter: activity => activity.actorAction === 'group_mention',
  },
  {
    value: 'actionable',
    label: 'Actionable',
    Icon: CheckCircle,
    filter: (activity): boolean => {
      const classification = activity.classification ?? ActivityClassification.PENDING;
      return classification === ActivityClassification.ACTIONABLE;
    },
  },
  {
    value: 'fyi',
    label: 'FYI',
    Icon: Info,
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
  const isOnIndexRoute = location.pathname === '/chat/activity';

  const activityPanelRef = useRef<ImperativePanelHandle>(null);

  // All hooks must be called before any conditional returns
  const [activeTab, setActiveTab] = useState<ActivityTab>('all');
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
      mixpanelService.track(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.ACTIVITY_TAB_CHANGED,
        tab: value as ActivityTab,
        showUnreadOnly: showUnreadOnly,
      });
      setActiveTab(value as ActivityTab);
    },
    [showUnreadOnly],
  );

  const handleUnreadToggle = useCallback((checked: boolean): void => {
    mixpanelService.track(EVENTS.INITIATE_ACTION, {
      type: EVENT_PROPERTIES.ACTION_TYPES.ACTIVITY_UNREAD_TOGGLED,
    });
    setShowUnreadOnly(checked);
    window.localStorage.setItem('activity_unread_toggle', String(checked));
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
          'workflow_question',
        ];
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
  const [isLoading, setIsLoading] = useState(false);
  const activityLoadStartTimeRef = useRef<number | null>(null);

  // Reset pagination when tab changes
  useEffect(() => {
    setActivities([]);
    setFetchCursor(null);
    setNextCursor(null);
    setHasMore(true);
    setIsLoading(false);
    activityLoadStartTimeRef.current = Date.now();
  }, [activeTab]);

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

  // Query with pagination - only fetches when fetchCursor changes
  const [activitiesPage, activitiesDetails] = useQuery(
    queries.userActivitiesPaginatedV2({
      limit: PAGE_SIZE,
      start: fetchCursor,
      types: currentTypes,
      classification: classificationFilter,
    }),
  );

  // Accumulate results when query completes
  useEffect(() => {
    if (activitiesDetails.type !== 'complete') {
      return; // Wait for query to complete before processing
    }

    setIsLoading(false);

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
      if (fetchCursor === null) {
        setActivities([]);
        setNextCursor(null);
      }
      setHasMore(false);
      return;
    }

    setActivities(prev => {
      if (fetchCursor === null) return activitiesPage;

      const combined = [...prev, ...activitiesPage];
      const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
      return unique;
    });

    setHasMore(activitiesPage.length >= PAGE_SIZE);

    // Store the next cursor but don't fetch yet - wait for handleEndReached
    const lastItemOfPage = activitiesPage[activitiesPage.length - 1];
    if (lastItemOfPage) {
      setNextCursor({
        id: lastItemOfPage.id,
        updatedAt: lastItemOfPage.updatedAt ?? lastItemOfPage.createdAt,
      });
    }
  }, [activitiesPage, activitiesDetails.type, fetchCursor]);

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

    return activities.filter(activity => {
      const matchesTab = activeTabConfig.filter(activity);
      const matchesReadState = showUnreadOnly ? !activity.isRead : true;
      return matchesTab && matchesReadState;
    });
  }, [activities, activeTab, showUnreadOnly, visibleTabs]);

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
      void zero.mutate(mutators.activities.markAsReadByFilter({ actorAction: 'replied' }));
      void zero.mutate(mutators.activities.markAsReadByFilter({ actorAction: 'replied_v2' }));
      return;
    } else if (activeTab === 'actionable') {
      filters.classification = ActivityClassification.ACTIONABLE;
    } else if (activeTab === 'fyi') {
      filters.classification = ActivityClassification.FYI;
    }

    void zero.mutate(mutators.activities.markAsReadByFilter(filters));
  };
  // Fetch all unread activities for counting
  const [unreadActivities] = useCachedQuery(queries.userUnreadActivities());

  const activityCounts = useMemo(() => {
    const counts: Record<ActivityTab, number> = {
      all: 0,
      your_mentions: 0,
      replies: 0,
      reactions: 0,
      tickets: 0,
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

      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.ACTIONABLE) {
        counts.actionable++;
      } else if (classification === ActivityClassification.FYI) {
        counts.fyi++;
      }
    });

    return counts;
  }, [unreadActivities]);

  const renderActivityList = (activityList: ActivityWithRelated[]): ReactElement => {
    const isExpanded = active === 'detailed';

    if (activityList.length > 0) {
      return (
        <div
          data-component='ActivityList'
          style={{ height: 'calc(100vh - 200px)' }}
          className='relative min-h-0 basis-0 grow flex flex-col'
        >
          <Virtuoso
            className='no-scrollbar'
            style={{ height: '100%' }}
            data={activityList}
            endReached={handleEndReached}
            computeItemKey={(_, activity) => activity.id}
            overscan={{ main: 2000, reverse: 500 }} // Prefetch ~25 items ahead (at ~80px each)
            itemContent={(_, activity) => (
              <div className='min-h-[0.5px]'>
                <ActivityItem activity={activity} isExpanded={isExpanded} />
              </div>
            )}
          />
        </div>
      );
    }

    return (
      <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground px-4 py-8'>
        <Bell className='w-16 h-16 mb-4' />
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
    <div
      data-id='activity-list-view'
      className='h-full bg-background flex flex-col max-w-full overflow-hidden'
    >
      <div className='px-4 py-4 flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          {!isMobile && (
            <Link
              to='/chat/dir'
              className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
              aria-label='Go back'
            >
              <ArrowLeft size={20} />
            </Link>
          )}
          <h2
            className='text-xl font-semibold text-foreground truncate'
            data-testid='activity-heading'
          >
            Activity
          </h2>
        </div>
        <div className='flex items-center gap-4'>
          {/* Unread Toggle */}
          <div className='flex items-center gap-3 flex-shrink-0'>
            <label
              htmlFor='activity-unread-filter'
              className='text-xs font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap'
            >
              Unread
            </label>

            <Switch.Root
              id='activity-unread-filter'
              checked={showUnreadOnly}
              onCheckedChange={handleUnreadToggle}
              data-track-category='ACTIVITY'
              data-track-name='UNREAD_FILTER_TOGGLE'
              data-track-metadata={JSON.stringify({
                filter_type: 'unread_only',
                filter_value: !showUnreadOnly,
              })}
              data-testid='activity-unread-toggle'
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full',
                'bg-muted transition-colors duration-200',
                'data-[state=checked]:bg-sidebar-badge-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              <Switch.Thumb
                className={cn(
                  'block h-4 w-4 rounded-full bg-background shadow-sm',
                  'transition-transform duration-200',
                  'translate-x-0.5 data-[state=checked]:translate-x-4',
                )}
              />
            </Switch.Root>
          </div>

          {/* Mark as Read Button */}
          <Button
            variant='outline'
            onClick={markActiveTabUnread}
            data-track-category='ACTIVITY'
            data-track-name={`MARK_TAB_READ`}
            data-track-metadata={JSON.stringify({
              tab: activeTab,
              action: 'mark_all_as_read',
            })}
            className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary'
          >
            <div className='text-xs font-medium text-muted-foreground'>Mark as read</div>
          </Button>

          {/* 3-dot menu with Actionable Toggle and View Toggle (Desktop & Mobile) */}
          <div className='relative' ref={mobileMenuRef}>
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className='p-2 rounded-md hover:bg-accent transition-colors duration-200'
              aria-label='More options'
              data-track-category='ACTIVITY'
              data-track-name='TOGGLE_MOBILE_MENU'
              data-track-metadata={JSON.stringify({ menuState: !showMobileMenu })}
              data-testid='activity-more-options-btn'
            >
              <MoreVertical size={20} className='text-muted-foreground' />
            </button>

            {showMobileMenu && (
              <div className='absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] z-50'>
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
                      'bg-muted transition-colors duration-200',
                      'data-[state=checked]:bg-sidebar-badge-accent',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    )}
                  >
                    <Switch.Thumb
                      className={cn(
                        'block h-4 w-4 rounded-full bg-background shadow-sm',
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
                  <FoldVertical className='h-4 w-4' />
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
                  <Fullscreen className='h-4 w-4' />
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
          <div className='overflow-x-auto border-b border-border no-scrollbar'>
            <Tabs.List
              className='flex items-center sm:justify-start min-w-max'
              data-testid='activity-tabs-list'
            >
              {visibleTabs.map(tab => {
                const count = activityCounts[tab.value];
                const IconComponent = tab.Icon;

                return (
                  <Tabs.Trigger key={tab.value} value={tab.value} asChild>
                    <button
                      data-track-category='ACTIVITY'
                      data-track-name={`TAB_CHANGE`}
                      data-track-metadata={JSON.stringify({ tab: tab.value })}
                      className={cn(
                        'px-1 py-2 flex items-center transition-all duration-100 cursor-pointer sm:px-4 justify-start gap-2',
                        activeTab === tab.value
                          ? 'border-b-2 border-primary'
                          : 'border-b-2 border-transparent',
                      )}
                    >
                      {IconComponent && (
                        <span
                          className={cn(
                            'size-4 flex items-center justify-center shrink-0',
                            activeTab === tab.value ? 'text-primary' : 'text-muted-foreground',
                          )}
                        >
                          <IconComponent className='w-4 h-4' />
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-xs sm:text-sm font-medium text-foreground truncate',
                          activeTab === tab.value ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {tab.label}
                      </span>
                      {count > 0 && (
                        <Badge
                          className={cn(
                            'h-3.5 text-[9px] px-1 leading-none shrink-0 sm:h-5 sm:text-xs sm:px-1.5 bg-sidebar-badge-accent',
                            count > 99 && 'sm:text-[10px]',
                          )}
                        >
                          {count > 99 ? '99+' : count}
                        </Badge>
                      )}
                    </button>
                  </Tabs.Trigger>
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
            }}
            className='focus-visible:outline-none'
          >
            {renderActivityList(filteredActivities)}
          </Tabs.Content>
        </Tabs.Root>
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
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-md'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='activity-screen-resize'
      >
        {/* LEFT PANEL - Activity List */}
        <Panel ref={activityPanelRef} defaultSize={20} minSize={30} maxSize={45}>
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'></div>
        </PanelResizeHandle>

        {/* RIGHT PANEL - Detail View */}
        <Panel>
          <div className='flex-1 flex flex-col bg-background relative h-full'>
            <div className='flex-1 h-full overflow-hidden flex items-center justify-center'>
              {isOnIndexRoute ? (
                <div className='flex flex-col items-center justify-center p-8 text-center'>
                  <Bell className='text-muted-foreground mb-4' size={64} />
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
      </PanelGroup>
    </div>
  );
};

export default ActivityListView;
