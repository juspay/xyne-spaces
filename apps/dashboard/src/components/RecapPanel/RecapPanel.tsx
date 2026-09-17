import { ReactElement, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Link, useNavigate, useParams, Outlet } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import {
  Settings,
  Sparkles,
  Clock,
  Hash,
  CheckCircle,
  Mail,
  MailOpen,
  CheckCheck,
  Calendar,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useRecapData } from '../../hooks/useRecapData';
import {
  RecapSubscription,
  RecapCard,
  RecapRangeMode,
  RecapTopic,
  TopicPoint,
} from './RecapPanel.types';
import { getYesterdayIST, formatRecapDate } from './RecapPanel.utils';
import RecapSettings from './RecapSettings';
import { RecapCalendarView, type RecapDateRange } from './RecapCalendarView';
import ProjectRecapPanel from './ProjectRecapPanel';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { usePlatform } from '../../hooks/usePlatform';
import { useCacConfig } from '@xyne/shared/hooks';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { XyneAIStar } from '../icons/xyne-ai';
import { Tooltip } from '../ui/Tooltip';
import { globalClickTracker } from '../../services/Analytics/globalClickTracker';

type RecapTab = 'channel' | 'project';

// Random greetings for the recap header

const RECAP_GREETINGS = [
  'Pleasant perusing 🙌',
  'Happy reading ✨',
  'Enjoy your read 📖',
  'Wishing you an insightful read 💡',
  'Hope you find this valuable 💎',
  'Dive in and explore 🚀',
  "Here's to a productive read ☕",
  'Enjoy the highlights 🌟',
  'Take a quick look through 👀',
  'Hope this summary helps 🤝',
  'Happy reviewing 📋',
];

// Get a random greeting (stable per session)
const getRandomGreeting = (): string => {
  const index = Math.floor(Math.random() * RECAP_GREETINGS.length);
  return RECAP_GREETINGS[index] ?? RECAP_GREETINGS[0]!;
};

// One scroll row: either a section heading or a channel card. Headers are items so
// they scroll with the list, matching the pre-virtualization layout.
type RecapListRow =
  | { kind: 'header'; id: string; node: ReactElement }
  | { kind: 'card'; id: string; card: RecapCard };

// Header pills in display order — 'custom' is rendered separately with a dropdown
const RANGE_PILLS: Array<{ mode: RecapRangeMode; label: string }> = [
  { mode: 'yesterday', label: 'Yesterday' },
  { mode: 'last7', label: 'Last 7 days' },
  { mode: 'last14', label: 'Last 14 days' },
];

const pillClassName = (isActive: boolean): string =>
  `px-3 py-1 text-xs font-medium rounded-full border transition-colors duration-150 ${
    isActive
      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
      : 'bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground'
  }`;

const RecapPanel = (): ReactElement => {
  const navigate = useNavigate();
  const params = useParams<{ channelId?: string; conversationId?: string }>();
  const zero = useZero();
  const { isMobile } = usePlatform();
  const { config: projectRecapEnabled } = useCacConfig<boolean>({
    key: 'project_recap_enabled',
    fallbackConfig: false,
  });

  // Show right panel when a cited thread is open
  const showThreadPanel = !!params.channelId;

  // Time-range mode (header pills) + custom range selection
  const [rangeMode, setRangeMode] = useState<RecapRangeMode>('yesterday');
  const [customRange, setCustomRange] = useState<RecapDateRange | null>(null);
  const [showCustomCalendar, setShowCustomCalendar] = useState(false);

  // Use the recap data hook for the active mode
  const {
    recapData,
    isLoading,
    subscriptions,
    isLoadingSubscriptions,
    isFirstTime,
    unreadCount,
    hasMoreChannels,
    loadMoreChannels,
  } = useRecapData({
      mode: rangeMode,
      customStart: customRange?.start ?? null,
      customEnd: customRange?.end ?? null,
    });

  // Active tab: channel or project
  const [activeTab, setActiveTab] = useState<RecapTab>('channel');

  // Stable random greeting for this session
  const [greeting] = useState(() => getRandomGreeting());

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Track if user just saved their first channel selection
  // This helps us show the loading state while Zero syncs
  const [justSavedFirstTime, setJustSavedFirstTime] = useState(false);

  // Track which cards are showing custom recap view (by channelId)
  const [customViewChannels, setCustomViewChannels] = useState<Set<string>>(new Set());

  // Reset justSavedFirstTime when subscriptions actually load
  useEffect(() => {
    if (justSavedFirstTime && subscriptions.length > 0) {
      setJustSavedFirstTime(false);
    }
  }, [justSavedFirstTime, subscriptions]);

  // Lookup for per-channel read state
  const subscriptionByChannel = useMemo(
    () => new Map<string, RecapSubscription>(subscriptions.map(sub => [sub.channelId, sub])),
    [subscriptions],
  );

  // Read = seen through the card's latest merged day. In Unread mode nothing is read.
  const isCardRead = useCallback(
    (card: RecapCard): boolean => {
      const sub = subscriptionByChannel.get(card.channelId);
      if (!sub?.lastSeenRecapDate) return false;
      return sub.lastSeenRecapDate >= (card.maxRecapDate ?? 0);
    },
    [subscriptionByChannel],
  );

  // Impression: a recap with cards is on screen. The clicks below (open channel,
  // citation, ask AI, mark read) have no denominator without this. Latched per
  // range + kind so re-renders and read/unread toggles don't refire; a different
  // pill or custom range is a new impression. No card content rides.
  const recapViewedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recapData || recapData.cards.length === 0) return;
    const isDefaultView = rangeMode === 'yesterday';
    const rangeKey = recapData.meta.rangeLabel ?? recapData.date;
    const customRecapCount = recapData.cards.filter(card => card.hasCustomRecap).length;
    const recapType = customRecapCount > 0 ? 'custom' : 'base';
    const key = `${rangeMode}:${rangeKey}:${recapType}`;
    if (recapViewedKeyRef.current === key) return;
    recapViewedKeyRef.current = key;
    globalClickTracker.trackManualEvent('RECAP_PANEL', 'RECAP_VIEWED', undefined, {
      recapType,
      customRecapCount,
      channelCount: recapData.cards.length,
      date: recapData.date,
      isToday: isDefaultView,
      unreadCount: isDefaultView ? unreadCount : 0,
      totalMessages: recapData.meta.totalMessages,
    });
  }, [rangeMode, recapData, unreadCount]);

  // Split cards into unread and read sections
  const { unreadCards, readCards } = useMemo(() => {
    if (!recapData) {
      return { unreadCards: [], readCards: [] };
    }

    const unread: RecapCard[] = [];
    const read: RecapCard[] = [];

    for (const card of recapData.cards) {
      if (isCardRead(card)) {
        read.push(card);
      } else {
        unread.push(card);
      }
    }

    return { unreadCards: unread, readCards: read };
  }, [recapData, isCardRead]);

  // Handle settings open/close
  const handleOpenSettings = useCallback((): void => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback((): void => {
    setIsSettingsOpen(false);
  }, []);

  // Handle pill selection
  const handleSelectPill = useCallback((mode: RecapRangeMode): void => {
    setRangeMode(mode);
    setShowCustomCalendar(false);
  }, []);

  // Handle custom range selection from the calendar dropdown
  const handleSelectRange = useCallback((range: RecapDateRange): void => {
    setCustomRange(range);
    setRangeMode('custom');
    setShowCustomCalendar(false);
  }, []);

  // Read controls live in the Yesterday pane only. The range panes are history views, and
  // lastSeenRecapDate is a single watermark — marking read from a backdated range would
  // also consume every older unread day, which is not what a browse view should do.
  const canMarkRead = rangeMode === 'yesterday';

  // Read through the card's OWN latest day, never a global "yesterday".
  const markCardRead = useCallback(
    (card: RecapCard, now: number): void => {
      const { dateObj: yesterdayDate } = getYesterdayIST();
      const recapDate = card.maxRecapDate ?? yesterdayDate.getTime();

      zero.mutate(
        mutators.recap.markChannelRecapAsRead({
          channelId: card.channelId,
          recapDate,
          timestamp: now,
        }),
      );

      // Also clear the channel's message unreads so it reads as caught up in the sidebar
      zero.mutate(
        mutators.channel.markChannelAsViewed({
          channelId: card.channelId,
          timestamp: now,
          draftMessageId: crypto.randomUUID(),
          draftMessage: '',
        }),
      );
    },
    [zero],
  );

  // Each channel at its own window end, not a global date
  const handleMarkAllAsRead = useCallback((): void => {
    if (unreadCards.length === 0 || !canMarkRead) return;
    const now = Date.now();
    unreadCards.forEach(card => markCardRead(card, now));
  }, [unreadCards, canMarkRead, markCardRead]);

  // Handle when settings is saved - track if this was a first-time save
  const handleSettingsSaved = useCallback((): void => {
    // If this was a first-time save, track it so we show loading while Zero syncs
    if (isFirstTime) {
      setJustSavedFirstTime(true);
    }
    setIsSettingsOpen(false);
  }, [isFirstTime]);

  // Opening a thread deliberately does NOT mark the card read — only the explicit
  // buttons move the pointer. A card can span weeks, so following one citation is not
  // the same as catching up on the channel.
  const openCitation = (
    card: RecapCard,
    citation: { conversationId?: string; messageId?: string },
    drilldown?: { conversationId: string | null; messageId: string | null },
  ): void => {
    const messageId = citation.messageId ?? drilldown?.messageId ?? undefined;
    const conversationId = citation.conversationId ?? drilldown?.conversationId ?? undefined;

    // Always navigate within the recap route so thread view opens inside RecapPanel context
    if (conversationId && messageId) {
      const hash = `#origin=${conversationId}&messageId=${messageId}`;
      void navigate(`/chat/dir/recap/${card.channelId}/${conversationId}${hash}`);
    } else if (conversationId) {
      const hash = `#origin=${conversationId}`;
      void navigate(`/chat/dir/recap/${card.channelId}/${conversationId}${hash}`);
    } else {
      void navigate(`/chat/dir/recap/${card.channelId}`);
    }
  };

  const renderPointText = (text: string): ReactElement => (
    <span
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), {
          ALLOWED_TAGS: ['strong'],
        }),
      }}
    />
  );

  const renderCitation = (
    card: RecapCard,
    point: TopicPoint,
    drilldown?: { conversationId: string | null; messageId: string | null },
  ): ReactElement => (
    <button
      onClick={() => openCitation(card, point, drilldown)}
      className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
      title={`View source for point ${point.citationNumber}`}
      data-track-category='RECAP_PANEL'
      data-track-name='CLICK_CITATION'
    >
      {point.citationNumber}
    </button>
  );

  // Deep-links into the thread the topic summarizes
  const renderTopicTitle = (
    card: RecapCard,
    topic: RecapTopic,
    variant: 'inline' | 'block',
  ): ReactElement => (
    <button
      onClick={() => openCitation(card, { conversationId: topic.conversationId })}
      className={`font-semibold text-foreground hover:underline text-left ${
        variant === 'inline' ? 'inline' : `${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed`
      }`}
      title='Open thread'
      data-track-category='RECAP_PANEL'
      data-track-name='CLICK_TOPIC_TITLE'
    >
      {topic.title}
    </button>
  );

  // Close the channel panel and return to recap root
  const handleCloseThreadPanel = useCallback((): void => {
    void navigate('/chat/dir/recap');
  }, [navigate]);

  const handleToggleRead = useCallback(
    (card: RecapCard, isCurrentlyRead: boolean): void => {
      const now = Date.now();

      try {
        if (isCurrentlyRead) {
          // Mark as unread - set lastSeenRecapDate to null
          zero.mutate(
            mutators.recap.markChannelRecapAsUnread({
              channelId: card.channelId,
              timestamp: now,
            }),
          );
        } else {
          markCardRead(card, now);
        }
        // Zero will auto-sync the subscriptions, no need to refresh
      } catch {
        // Error handling silently
      }
    },
    [zero, markCardRead],
  );

  const buildAskAIThreadInfo = useCallback(
    (
      card: RecapCard,
      pointCitations: Record<string, { conversationId?: string; messageId?: string }> | undefined,
      drilldown?: { conversationId: string | null; messageId: string | null },
    ): ThreadInfo | null => {
      const firstCitation = Object.values(pointCitations ?? {}).find(
        citation => citation.conversationId,
      );
      const conversationId =
        firstCitation?.conversationId ?? drilldown?.conversationId ?? undefined;
      if (!conversationId) return null;

      const messageId = firstCitation?.messageId ?? drilldown?.messageId ?? undefined;
      return {
        conversationId,
        channelId: card.channelId,
        senderName: card.channelName,
        previewText: `${card.channelName} recap reference`,
        ...(messageId && { messageId }),
        isThreadMessage: true,
      };
    },
    [],
  );

  const handleAskAIAboutRecapReference = useCallback(
    (
      card: RecapCard,
      pointCitations: Record<string, { conversationId?: string; messageId?: string }> | undefined,
      drilldown?: { conversationId: string | null; messageId: string | null },
    ): void => {
      const threadInfo = buildAskAIThreadInfo(card, pointCitations, drilldown);
      if (!threadInfo) return;

      xyneAIActor.send({
        type: 'OPEN',
        channelId: card.channelId,
        threadInfo,
        startFreshChat: true,
        trackSource: 'recap_panel',
      });
    },
    [buildAskAIThreadInfo],
  );

  // Header subtitle per mode ("127 unread messages across 4 channels" etc.)
  const subtitle = useMemo((): string => {
    if (!recapData || recapData.cards.length === 0) return '';
    const total = recapData.meta.totalMessages;
    switch (rangeMode) {
      case 'yesterday':
        return `Recapping ${total} messages from ${formatRecapDate(recapData.date)}`;
      default:
        return `${total} messages · ${recapData.meta.rangeLabel ?? ''}`;
    }
  }, [rangeMode, recapData]);

  // Render recap cards content (left/center panel)
  const renderRecapCards = (): ReactElement => {
    const header = (
      <div className='text-center p-5 pb-4 flex-shrink-0'>
        <h2 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-semibold text-foreground mb-1`}>
          {greeting}
        </h2>
        {subtitle && <p className='text-sm text-muted-foreground'>{subtitle}</p>}

        {/* Time-range pills */}
        <div className='flex items-center justify-center gap-2 flex-wrap mt-3'>
          {RANGE_PILLS.map(({ mode, label }) => (
            <button
              key={mode}
              type='button'
              onClick={() => handleSelectPill(mode)}
              className={pillClassName(rangeMode === mode)}
              data-track-category='RECAP_PANEL'
              data-track-name={`PILL_${mode.toUpperCase()}`}
            >
              {label}
            </button>
          ))}

          {/* Custom range pill with calendar dropdown */}
          <div className='relative'>
            <button
              type='button'
              onClick={() => setShowCustomCalendar(prev => !prev)}
              className={`${pillClassName(rangeMode === 'custom')} flex items-center gap-1`}
              data-track-category='RECAP_PANEL'
              data-track-name='PILL_CUSTOM'
            >
              <Calendar size={12} />
              <span>Custom</span>
              <ChevronDown size={12} />
            </button>

            {showCustomCalendar && (
              <div className='absolute top-full mt-2 right-0 z-50 w-[300px]'>
                <div className='bg-background rounded-xl shadow-2xl border border-border overflow-hidden'>
                  <RecapCalendarView
                    onRangeSelect={handleSelectRange}
                    selectedRange={customRange}
                    onClose={() => setShowCustomCalendar(false)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );

    // Show loading spinner while recaps stream in
    if (isLoading) {
      return (
        <div className='h-full flex flex-col overflow-hidden'>
          {header}
          <div className='flex-1 min-h-0 overflow-y-auto px-5 pb-6'>
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <Loader2 className='text-blue-500 mb-4 animate-spin' size={48} />
              <p className='text-muted-foreground text-lg font-medium'>Loading recaps...</p>
            </div>
          </div>
        </div>
      );
    }

    // Empty state per mode
    if (!recapData || recapData.cards.length === 0) {
      return (
        <div className='h-full flex flex-col overflow-hidden'>
          {header}
          <div className='flex-1 min-h-0 overflow-y-auto px-5 pb-6'>
            <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
              <Clock className='text-muted-foreground mb-4' size={48} />
              <p className='text-muted-foreground text-lg font-medium'>
                {rangeMode === 'yesterday'
                  ? 'Nothing important happened yesterday.'
                  : `No recaps available for ${recapData?.meta.rangeLabel ?? 'this range'}.`}
              </p>
              <p className='text-xs text-muted-foreground/60 text-center mt-4'>
                This tool uses AI to generate responses, so some information may be inaccurate.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Render a single recap card
    const renderCard = (card: RecapCard): ReactElement => {
      const isRead = isCardRead(card);
      const isShowingCustom = card.hasCustomRecap && !customViewChannels.has(card.channelId);

      // Pick which clustered view to display based on toggle state
      const displayTopics = (isShowingCustom ? card.customTopics : card.topics) ?? [];
      const displayUngrouped =
        (isShowingCustom ? card.customUngroupedPoints : card.ungroupedPoints) ?? [];
      // Still what the Ask AI hand-off consumes
      const displayPointCitations = isShowingCustom
        ? card.customPointCitations
        : card.pointCitations;
      const displayDrilldown = isShowingCustom
        ? (card.customDrilldown ?? card.drilldown)
        : card.drilldown;
      const displayMessageCount = isShowingCustom
        ? (card.customMessageCount ?? card.messageCount)
        : card.messageCount;

      const isMultiDay = card.spanStart !== card.spanEnd;

      return (
        <div
          className={`border rounded-xl p-5 bg-card shadow-sm mb-5 transition-all duration-300 hover:shadow-md ${
            isRead
              ? 'border-l-[3px] border-l-green-500 border-border'
              : 'border-l-[3px] border-l-blue-500 border-border'
          }`}
        >
          {/* Card header: channel name (+ recap type toggle) | span + message count */}
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-2 text-foreground font-semibold text-base'>
              <Link
                to={`/chat/dir/${card.channelId}`}
                state={{ trackSource: 'recap' }}
                className='flex items-center gap-2 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
                title={`Go to #${card.channelName}`}
                data-track-category='RECAP_PANEL'
                data-track-name='OPEN_CHANNEL_FROM_RECAP'
                data-track-label='Open channel from recap'
                data-track-metadata={JSON.stringify({
                  channelId: card.channelId,
                  source: 'recap',
                })}
              >
                <Hash size={16} className='text-muted-foreground' />
                <span>{card.channelName}</span>
              </Link>
              {card.hasCustomRecap && (
                <div className='flex items-center gap-0.5 ml-1 bg-muted rounded-md p-0.5'>
                  <button
                    onClick={() =>
                      setCustomViewChannels(prev => {
                        const next = new Set(prev);
                        next.add(card.channelId);
                        return next;
                      })
                    }
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      !isShowingCustom
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    data-track-category='RECAP_PANEL'
                    data-track-name='VIEW_BASE_RECAP'
                  >
                    Default Recap
                  </button>
                  <button
                    onClick={() =>
                      setCustomViewChannels(prev => {
                        const next = new Set(prev);
                        next.delete(card.channelId);
                        return next;
                      })
                    }
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      isShowingCustom
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    data-track-category='RECAP_PANEL'
                    data-track-name='VIEW_CUSTOM_RECAP'
                  >
                    Custom Recap
                  </button>
                </div>
              )}
            </div>
            {(card.spanStart || card.spanEnd) && (
              <span className='text-xs text-muted-foreground whitespace-nowrap ml-3'>
                {isMultiDay ? `${card.spanStart} – ${card.spanEnd}` : card.spanEnd}
                {' · '}
                {displayMessageCount} messages
              </span>
            )}
          </div>

          {/* One thread = one topic, every row led by its title */}
          <div className='mb-5'>
            {displayTopics.map((topic, topicIdx) => {
              const single = topic.points.length === 1 ? topic.points[0] : undefined;

              return (
                <div key={topic.key} className={topicIdx > 0 ? 'mt-8' : ''}>
                  {/* Single titled point renders inline: Title — detail */}
                  {single && topic.title ? (
                    <span
                      className={`text-foreground ${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed font-normal font-['Inter'] inline`}
                    >
                      {renderTopicTitle(card, topic, 'inline')}
                      <span className='mx-1 text-muted-foreground'>—</span>
                      {renderPointText(single.text)}
                      {renderCitation(card, single, displayDrilldown)}
                    </span>
                  ) : (
                    <>
                      {/* Topic title row */}
                      {topic.title && (
                        <div className='mb-1.5'>{renderTopicTitle(card, topic, 'block')}</div>
                      )}

                      <ul className='space-y-2'>
                        {topic.points.map(point => (
                          <li key={point.citationNumber} className='flex items-start'>
                            {/* Prior-context points are dimmed; in a one-day window they
                                are most of a topic, so they carry no extra label */}
                            <span
                              className={`${
                                point.isContext ? 'text-muted-foreground' : 'text-foreground'
                              } ${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed font-normal font-['Inter'] inline`}
                            >
                              <span className='mr-2 text-muted-foreground'>•</span>
                              {renderPointText(point.text)}
                              {renderCitation(card, point, displayDrilldown)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}

            {/* Threadless points, after the clusters */}
            {displayUngrouped.length > 0 && (
              <ul className={`space-y-2 ${displayTopics.length > 0 ? 'mt-8' : ''}`}>
                {displayUngrouped.map(point => (
                  <li key={point.citationNumber} className='flex items-start'>
                    <span
                      className={`text-foreground ${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed font-normal font-['Inter'] inline`}
                    >
                      <span className='mr-2 text-muted-foreground'>•</span>
                      {renderPointText(point.text)}
                      {renderCitation(card, point, displayDrilldown)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Card footer */}
          <div className='flex items-center justify-between gap-3 pt-4 border-t border-border'>
            <span className={`text-muted-foreground ${isMobile ? 'text-xs' : 'text-sm'}`}>
              {displayMessageCount} {isMobile ? 'messages' : 'messages summarized'}
            </span>
            <div className='flex items-center gap-2'>
              {buildAskAIThreadInfo(card, displayPointCitations, displayDrilldown) && (
                <Tooltip content='Ask AI about the referenced thread'>
                  <button
                    type='button'
                    onClick={() =>
                      handleAskAIAboutRecapReference(card, displayPointCitations, displayDrilldown)
                    }
                    className='flex items-center gap-1.5 text-xs font-medium transition-colors px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-600 hover:bg-blue-500/10'
                    data-track-category='RECAP_PANEL'
                    data-track-name='ASK_AI_RECAP_REFERENCE'
                  >
                    <XyneAIStar size={13} />
                    <span>Ask AI</span>
                  </button>
                </Tooltip>
              )}
              {canMarkRead && (
                <button
                  onClick={() => void handleToggleRead(card, isRead)}
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors px-2.5 py-1 rounded-md border ${
                    isRead
                      ? 'border-blue-500/30 text-blue-600 hover:bg-blue-500/10'
                      : 'border-green-500/30 text-green-600 hover:bg-green-500/10'
                  }`}
                  data-track-category='RECAP_PANEL'
                  data-track-name={isRead ? 'MARK_AS_UNREAD' : 'MARK_AS_READ'}
                  data-ph-capture-attribute-track-id={
                    isRead ? 'mark_recap_unread' : 'mark_recap_read'
                  }
                >
                  {isRead ? (
                    <>
                      <MailOpen size={13} />
                      <span>Mark as unread</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={13} />
                      <span>Mark as read</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    };

    // Render a section header
    const renderSectionHeader = (
      title: string,
      count: number,
      icon: ReactElement,
    ): ReactElement => (
      <div className='flex items-center gap-2 mb-3 mt-2'>
        {icon}
        <h3 className='text-sm font-semibold text-foreground'>{title}</h3>
        <span className='text-xs text-muted-foreground font-medium'>({count})</span>
      </div>
    );

    // Flatten both sections into one scroll list for the virtualizer
    const listRows: RecapListRow[] = [];
    if (unreadCards.length > 0) {
      listRows.push({
        kind: 'header',
        id: 'header:unread',
        node: (
          <div className='flex items-center justify-between mb-3 mt-2'>
            <div className='flex items-center gap-2'>
              <Mail size={16} className='text-muted-foreground' />
              <h3 className='text-sm font-semibold text-foreground'>Unread Recap</h3>
              <span className='text-xs text-muted-foreground font-medium'>
                ({unreadCards.length})
              </span>
            </div>
            {canMarkRead && (
              <button
                onClick={handleMarkAllAsRead}
                className='flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-green-600 bg-green-500/10 hover:bg-green-500/20 rounded-md border border-green-500/30 transition-colors'
                title='Mark all as read'
                data-track-category='RECAP_PANEL'
                data-track-name='MARK_ALL_AS_READ'
                data-ph-capture-attribute-track-id='mark_all_recap_read'
              >
                <CheckCheck size={12} />
                <span>Mark all as read</span>
              </button>
            )}
          </div>
        ),
      });
      for (const card of unreadCards) {
        listRows.push({ kind: 'card', id: `unread:${card.channelId}`, card });
      }
    }
    if (readCards.length > 0) {
      listRows.push({
        kind: 'header',
        id: 'header:read',
        node: renderSectionHeader(
          'Read Recap',
          readCards.length,
          <MailOpen size={16} className='text-green-500' />,
        ),
      });
      for (const card of readCards) {
        listRows.push({ kind: 'card', id: `read:${card.channelId}`, card });
      }
    }

    return (
      <div className='h-full flex flex-col overflow-hidden'>
        {/* Header Section - fixed at top */}
        {header}

        {/* Scrollable content area with sections */}
        {/* Virtualized: a wide range would otherwise mount thousands of bullets at once.
            Section headers ride in the item list (rather than GroupedVirtuoso's sticky
            group headers) so scrolling behaves as it did before. Reaching the end widens
            the query's channelIds, which is what pulls the next page. */}
        <Virtuoso<RecapListRow>
          data={listRows}
          className='flex-1 min-h-0'
          style={{ height: '100%' }}
          defaultItemHeight={280}
          increaseViewportBy={{ top: 400, bottom: 800 }}
          computeItemKey={(_, row) => row.id}
          endReached={() => {
            if (hasMoreChannels) loadMoreChannels();
          }}
          itemContent={(_, row) =>
            row.kind === 'header' ? (
              <div className='px-5'>{row.node}</div>
            ) : (
              <div className='px-5'>{renderCard(row.card)}</div>
            )
          }
          components={{
            Footer: () =>
              hasMoreChannels ? (
                <div className='py-4 text-center text-xs text-muted-foreground'>
                  Loading more channels…
                </div>
              ) : recapData.meta.estimatedTimeSavedMinutes > 0 ? (
                <div className='px-5 pb-6'>
                  <div className='rounded-2xl p-6 text-center bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-2 border-green-200 mb-5 mt-2 shadow-lg'>
                    <h3 className='text-lg font-bold text-gray-900 mb-2'>
                      🎉 <span className='text-green-600'>Rejoice!</span>
                    </h3>
                    <p className='text-sm text-gray-700 mb-2'>
                      You saved about{' '}
                      <span className='font-semibold text-green-600'>
                        {recapData.meta.estimatedTimeSavedMinutes} minutes
                      </span>{' '}
                      catching up on {recapData.meta.totalMessages} messages in{' '}
                      {recapData.cards.length} channels.
                    </p>
                    <p className='text-xs text-gray-500'>Time well spent! ✨</p>
                  </div>
                </div>
              ) : null,
          }}
        />
      </div>
    );
  };

  // Render first-time welcome content for channel tab
  const renderChannelContent = (): ReactElement => {
    // First-time users see the welcome screen
    if (isFirstTime && !isLoadingSubscriptions) {
      return (
        <div className='flex flex-col items-center justify-center h-full p-8 text-center bg-background'>
          <Clock className='text-muted-foreground mb-4' size={48} />
          <h2 className='text-xl font-semibold text-foreground mb-2'>
            Use AI recaps to focus in — without missing out
          </h2>
          <p className='text-muted-foreground text-sm mb-6 max-w-md'>
            Get daily AI-powered summaries of conversations across your selected channels,
            highlighting key discussions, decisions, and important information.
          </p>
          <button
            onClick={handleOpenSettings}
            className='px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors duration-200 font-medium cursor-pointer'
            data-track-category='RECAP_PANEL'
            data-track-name='OPEN_CHANNEL_SELECTION_FIRST_TIME'
            type='button'
          >
            Choose Channels
          </button>
        </div>
      );
    }

    // Returning users see their recap cards
    return renderRecapCards();
  };

  // Main content — split when channel panel is open
  return (
    <>
      <div className='flex h-full bg-background'>
        {/* Left: Recap cards — hidden on mobile when thread is open */}
        <div
          className={`flex flex-col border-r border-border bg-background
            ${showThreadPanel ? (isMobile ? 'hidden' : 'w-1/2') : 'w-full'}`}
        >
          {/* Header */}
          <div className='p-4 bg-background border-b border-border flex-shrink-0'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h3 className='font-bold text-foreground text-xl'>Recap</h3>
                <Sparkles size={20} className='text-blue-500' />
                {/* Channel / Project toggle — only shown when project recap is enabled */}
                {projectRecapEnabled && (
                  <div className='flex items-center gap-0.5 ml-2 bg-muted rounded-md p-0.5'>
                    <button
                      onClick={() => setActiveTab('channel')}
                      className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                        activeTab === 'channel'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      data-track-category='RECAP_PANEL'
                      data-track-name='TAB_CHANNEL'
                    >
                      Channel
                    </button>
                    <button
                      onClick={() => setActiveTab('project')}
                      className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                        activeTab === 'project'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      data-track-category='RECAP_PANEL'
                      data-track-name='TAB_PROJECT'
                    >
                      Project
                    </button>
                  </div>
                )}
              </div>
              {!isFirstTime && (
                <div className='flex items-center gap-1'>
                  <button
                    onClick={handleOpenSettings}
                    className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200'
                    aria-label='Settings'
                    title='Manage channels'
                    data-track-category='RECAP_PANEL'
                    data-track-name='OPEN_SETTINGS'
                  >
                    <Settings size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Scrollable recap cards */}
          <div className='flex-1 overflow-y-auto bg-muted/30'>
            {activeTab === 'channel' ? renderChannelContent() : <ProjectRecapPanel />}
          </div>
        </div>

        {/* Right: Thread panel — full screen on mobile, half width on desktop */}
        {showThreadPanel && (
          <div className={`${isMobile ? 'w-full' : 'w-1/2'} flex flex-col h-full bg-background`}>
            <div className='flex-1 h-full overflow-hidden'>
              <Outlet context={{ onClose: handleCloseThreadPanel }} />
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <RecapSettings
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        onSaved={handleSettingsSaved}
      />

      {/* Click outside handler for the custom range dropdown */}
      {showCustomCalendar && (
        <div
          className='fixed inset-0 z-40'
          onClick={() => setShowCustomCalendar(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setShowCustomCalendar(false);
            }
          }}
          role='button'
          tabIndex={0}
          aria-label='Close calendar'
          data-track-category='RECAP_PANEL'
          data-track-name='CLOSE_CALENDAR_OUTSIDE_CLICK'
        />
      )}
    </>
  );
};

export default RecapPanel;
