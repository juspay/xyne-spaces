import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Link, useNavigate, useParams, Outlet } from 'react-router-dom';
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
  ChevronLeft,
  Loader2,
} from 'lucide-react';
import { useRecapData } from '../../hooks/useRecapData';
import { RecapSubscription, RecapCard } from './RecapPanel.types';
import { getYesterdayIST, formatRecapDate } from './RecapPanel.utils';
import RecapSettings from './RecapSettings';
import { RecapCalendarView } from './RecapCalendarView';
import ProjectRecapPanel from './ProjectRecapPanel';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { usePlatform } from '../../hooks/usePlatform';
import { useCacConfig } from '@xyne/shared/hooks';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { XyneAIStar } from '../icons/xyne-ai';
import { Tooltip } from '../ui/Tooltip';

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

  // Use the cached recap data hook
  const { recapData, subscriptions, isLoadingSubscriptions, isFirstTime } = useRecapData();

  // Active tab: channel or project
  const [activeTab, setActiveTab] = useState<RecapTab>('channel');

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Track if user just saved their first channel selection
  // This helps us show the loading state while Zero syncs
  const [justSavedFirstTime, setJustSavedFirstTime] = useState(false);

  // State
  const [markedAsReadChannels, setMarkedAsReadChannels] = useState<Set<string>>(new Set());
  // Track which cards are showing custom recap view (by channelId)
  const [customViewChannels, setCustomViewChannels] = useState<Set<string>>(new Set());

  // Stable random greeting for this session
  const [greeting] = useState(() => getRandomGreeting());

  // Calendar view state
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Use the recap data hook with selected date for historical view
  const { recapData: historicalRecapData, isLoading: isLoadingHistorical } =
    useRecapData(selectedDate);

  // Auto-open settings modal for first-time users when they click "Choose Channels"
  // The modal is opened via handleOpenSettings

  // Reset justSavedFirstTime when subscriptions actually load
  useEffect(() => {
    if (justSavedFirstTime && subscriptions.length > 0) {
      setJustSavedFirstTime(false);
    }
  }, [justSavedFirstTime, subscriptions]);

  // Calculate marked as read channels from subscription details (no extra API call needed)
  useEffect(() => {
    if (subscriptions.length > 0 && recapData) {
      const { dateObj: yesterdayDate } = getYesterdayIST();
      // Use milliseconds to match PostgreSQL DateTime (Zero syncs as milliseconds)
      const yesterdayTimestamp = yesterdayDate.getTime();
      const readChannels = new Set<string>();
      subscriptions.forEach((sub: RecapSubscription) => {
        // lastSeenRecapDate is a timestamp in milliseconds, compare as numbers
        if (sub.lastSeenRecapDate && sub.lastSeenRecapDate >= yesterdayTimestamp) {
          readChannels.add(sub.channelId);
        }
      });
      setMarkedAsReadChannels(readChannels);
    }
  }, [subscriptions, recapData]);

  // Determine if we're in historical view based on selectedDate, not just data presence
  const isHistoricalView = selectedDate !== null;

  // Split cards into unread and read sections (moved up to be used in handleMarkAllAsRead)
  const { unreadCards, readCards } = useMemo(() => {
    const dataToUse = isHistoricalView ? historicalRecapData : recapData;
    if (!dataToUse) {
      return { unreadCards: [], readCards: [] };
    }

    const unread: RecapCard[] = [];
    const read: RecapCard[] = [];

    for (const card of dataToUse.cards) {
      // For historical data, consider all as read since it's past date
      if (isHistoricalView) {
        read.push(card);
      } else if (markedAsReadChannels.has(card.channelId)) {
        read.push(card);
      } else {
        unread.push(card);
      }
    }

    return { unreadCards: unread, readCards: read };
  }, [recapData, historicalRecapData, markedAsReadChannels, isHistoricalView]);

  // Handle settings open/close
  const handleOpenSettings = useCallback((): void => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback((): void => {
    setIsSettingsOpen(false);
  }, []);

  // Get today's date string for the Today button
  const getTodayDateStr = useCallback((): string => {
    return new Date().toLocaleDateString('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }, []);

  // Handle date selection
  const handleSelectDate = useCallback((dateStr: string): void => {
    setSelectedDate(dateStr);
    setShowCalendar(false);
  }, []);

  // Handle going back to current day's recap
  const handleBackToCurrent = useCallback((): void => {
    setSelectedDate(null);
  }, []);

  // Handle mark all as read
  const handleMarkAllAsRead = useCallback((): void => {
    if (unreadCards.length === 0) return;

    const { dateObj: yesterdayDate } = getYesterdayIST();
    const yesterdayTimestamp = yesterdayDate.getTime();
    const now = Date.now();

    // Mark all subscriptions as seen for yesterday's recap
    zero.mutate(
      mutators.recap.markSeen({
        recapDate: yesterdayTimestamp,
        timestamp: now,
      }),
    );

    // Also mark all unread channels as viewed (messages read)
    // This ensures the channels appear as "read" in the sidebar
    unreadCards.forEach(card => {
      zero.mutate(
        mutators.channel.markChannelAsViewed({
          channelId: card.channelId,
          timestamp: now,
          draftMessageId: crypto.randomUUID(),
          draftMessage: '',
        }),
      );
    });
  }, [unreadCards, zero]);

  // Handle when settings is saved - track if this was a first-time save
  const handleSettingsSaved = useCallback((): void => {
    // If this was a first-time save, track it so we show loading while Zero syncs
    if (isFirstTime) {
      setJustSavedFirstTime(true);
    }
    setIsSettingsOpen(false);
  }, [isFirstTime]);

  // Handle citation click - open thread view in right panel while keeping recap visible
  const handleCitationClick = (
    channelId: string,
    pointNumber: number,
    pointCitations: Record<string, { conversationId?: string; messageId?: string }> | undefined,
    drilldown?: { conversationId: string | null; messageId: string | null },
  ): void => {
    const pointKey = String(pointNumber);

    // Like ask AI: read conversationId and messageId directly from per-point data
    const pointCitation = pointCitations?.[pointKey];
    const messageId = pointCitation?.messageId ?? drilldown?.messageId ?? undefined;
    const conversationId = pointCitation?.conversationId ?? drilldown?.conversationId ?? undefined;

    const now = Date.now();

    // Mark the channel recap as read when user clicks a citation
    if (!historicalRecapData && !markedAsReadChannels.has(channelId)) {
      const { dateObj: yesterdayDate } = getYesterdayIST();
      const yesterdayTimestamp = yesterdayDate.getTime();

      zero.mutate(
        mutators.recap.markChannelRecapAsRead({
          channelId,
          recapDate: yesterdayTimestamp,
          timestamp: now,
        }),
      );
    }

    // Always navigate within the recap route so thread view opens inside RecapPanel context
    if (conversationId && messageId) {
      const hash = `#origin=${conversationId}&messageId=${messageId}`;
      void navigate(`/chat/dir/recap/${channelId}/${conversationId}${hash}`);
    } else if (conversationId) {
      const hash = `#origin=${conversationId}`;
      void navigate(`/chat/dir/recap/${channelId}/${conversationId}${hash}`);
    } else {
      void navigate(`/chat/dir/recap/${channelId}`);
    }
  };

  // Close the channel panel and return to recap root
  const handleCloseThreadPanel = useCallback((): void => {
    void navigate('/chat/dir/recap');
  }, [navigate]);

  const handleToggleRead = useCallback(
    (channelId: string, isCurrentlyRead: boolean): void => {
      const { dateObj: yesterdayDate } = getYesterdayIST();
      // Use milliseconds to match PostgreSQL DateTime (Zero syncs as milliseconds)
      const yesterdayTimestamp = yesterdayDate.getTime();
      const now = Date.now();

      try {
        if (isCurrentlyRead) {
          // Mark as unread - set lastSeenRecapDate to null
          zero.mutate(
            mutators.recap.markChannelRecapAsUnread({
              channelId,
              timestamp: now,
            }),
          );
        } else {
          // Mark as read - set lastSeenRecapDate to yesterday
          zero.mutate(
            mutators.recap.markChannelRecapAsRead({
              channelId,
              recapDate: yesterdayTimestamp,
              timestamp: now,
            }),
          );

          // Also mark the channel as viewed (messages read)
          // This ensures the channel appears as "read" in the sidebar
          zero.mutate(
            mutators.channel.markChannelAsViewed({
              channelId,
              timestamp: now,
              draftMessageId: crypto.randomUUID(),
              draftMessage: '',
            }),
          );
        }
        // Zero will auto-sync the subscriptions, no need to refresh
      } catch {
        // Error handling silently
      }
    },
    [zero],
  );

  // Helper to get previous day date string
  const getPreviousDayDateStr = (dateStr: string): string => {
    const date = new Date(dateStr);
    const prevDate = new Date(date);
    prevDate.setDate(date.getDate() - 1);
    return prevDate.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

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
      });
    },
    [buildAskAIThreadInfo],
  );

  // Render recap cards content (left/center panel)
  const renderRecapCards = (): ReactElement => {
    // Show loading spinner when fetching historical data
    if (isLoadingHistorical && selectedDate) {
      return (
        <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
          <Loader2 className='text-blue-500 mb-4 animate-spin' size={48} />
          <p className='text-muted-foreground text-lg font-medium'>
            Loading recap for {formatRecapDate(getPreviousDayDateStr(selectedDate))}...
          </p>
        </div>
      );
    }

    const dataToUse = historicalRecapData || recapData;

    // Show messages if no recap available for historical date
    if (!dataToUse || dataToUse.cards.length === 0) {
      const displayDate = selectedDate
        ? getPreviousDayDateStr(selectedDate)
        : historicalRecapData?.date || '';
      return (
        <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
          <Clock className='text-muted-foreground mb-4' size={48} />
          <p className='text-muted-foreground text-lg font-medium'>
            {historicalRecapData
              ? `No recap available for ${formatRecapDate(displayDate)}.`
              : 'Nothing important happened yesterday.'}
          </p>
          {historicalRecapData && (
            <p className='text-sm text-muted-foreground/80 mt-2'>
              Messages from that day are still available in the channel.
            </p>
          )}
          <p className='text-xs text-muted-foreground/60 text-center mt-4'>
            This tool uses AI to generate responses, so some information may be inaccurate.
          </p>
        </div>
      );
    }

    // Render a single recap card
    const renderCard = (card: RecapCard): ReactElement => {
      const isRead = isHistoricalView ? true : markedAsReadChannels.has(card.channelId);
      const isShowingCustom = card.hasCustomRecap && !customViewChannels.has(card.channelId);

      // Pick which summary/citations to display based on toggle state
      const displaySummary = isShowingCustom ? (card.customSummary ?? []) : card.summary;
      const displayPointCitations = isShowingCustom
        ? card.customPointCitations
        : card.pointCitations;
      const displayDrilldown = isShowingCustom
        ? (card.customDrilldown ?? card.drilldown)
        : card.drilldown;
      const displayMessageCount = isShowingCustom
        ? (card.customMessageCount ?? card.messageCount)
        : card.messageCount;

      return (
        <div
          className={`border rounded-xl p-5 bg-card shadow-sm mb-5 transition-all duration-300 hover:shadow-md ${
            isRead
              ? 'border-l-[3px] border-l-green-500 border-border'
              : 'border-l-[3px] border-l-blue-500 border-border'
          }`}
        >
          {/* Card header: channel name + recap type toggle */}
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-2 text-foreground font-semibold text-base'>
              <Link
                to={`/chat/dir/${card.channelId}`}
                className='flex items-center gap-2 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
                title={`Go to #${card.channelName}`}
                data-track-category='RECAP_PANEL'
                data-track-name='OPEN_CHANNEL_FROM_RECAP'
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
          </div>

          {/* Summary points */}
          <div className='mb-5'>
            <ul className='space-y-2'>
              {displaySummary.map((point: string, idx: number) => (
                <li key={idx} className='flex items-start'>
                  <span
                    className={`text-foreground ${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed font-normal font-['Inter'] inline`}
                  >
                    <span className='mr-2 text-muted-foreground'>•</span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          point.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                          { ALLOWED_TAGS: ['strong'] },
                        ),
                      }}
                    />
                    <button
                      onClick={() =>
                        handleCitationClick(
                          card.channelId,
                          idx + 1,
                          displayPointCitations,
                          displayDrilldown,
                        )
                      }
                      className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
                      title={`View source for point ${idx + 1}`}
                      data-track-category='RECAP_PANEL'
                      data-track-name='CLICK_CITATION'
                    >
                      {idx + 1}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
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
              {!isHistoricalView && (
                <button
                  onClick={() => void handleToggleRead(card.channelId, isRead)}
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

    return (
      <div className='h-full flex flex-col overflow-hidden'>
        {/* Header Section - fixed at top */}
        <div className='text-center p-5 pb-4 flex-shrink-0'>
          <h2 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-semibold text-foreground mb-1`}>
            {isHistoricalView ? 'Historical Recap' : greeting}
          </h2>
          <p className='text-sm text-muted-foreground'>
            {isHistoricalView && selectedDate
              ? `Recapping ${dataToUse.meta.totalMessages} messages from ${formatRecapDate(getPreviousDayDateStr(selectedDate))}`
              : `Recapping ${dataToUse.meta.totalMessages} messages from ${formatRecapDate(dataToUse.date)}`}
          </p>
          {isHistoricalView && selectedDate && (
            <p className='text-xs text-muted-foreground/70 mt-1'>
              Selected {formatRecapDate(selectedDate)} · Recaps cover the previous day
            </p>
          )}
        </div>

        {/* Scrollable content area with sections */}
        <div className='flex-1 min-h-0 overflow-y-auto px-5 pb-6'>
          {/* Unread Recap Section */}
          {unreadCards.length > 0 && (
            <div className='mb-6'>
              <div className='flex items-center justify-between mb-3 mt-2'>
                <div className='flex items-center gap-2'>
                  <Mail size={16} className='text-muted-foreground' />
                  <h3 className='text-sm font-semibold text-foreground'>Unread Recap</h3>
                  <span className='text-xs text-muted-foreground font-medium'>
                    ({unreadCards.length})
                  </span>
                </div>
                {!isHistoricalView && (
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
              {unreadCards.map(card => (
                <div key={card.channelId}>{renderCard(card)}</div>
              ))}
            </div>
          )}

          {/* Read Recap Section */}
          {readCards.length > 0 && (
            <div className='mb-6'>
              {renderSectionHeader(
                isHistoricalView ? 'Recap' : 'Read Recap',
                readCards.length,
                <MailOpen size={16} className='text-green-500' />,
              )}
              {readCards.map(card => (
                <div key={card.channelId}>{renderCard(card)}</div>
              ))}
            </div>
          )}

          {/* Footer with time saved - enhanced with gradient */}
          {/* Show for both current and historical recaps */}
          {dataToUse.meta.estimatedTimeSavedMinutes > 0 && (
            <div className='rounded-2xl p-6 text-center bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-2 border-green-200 mb-5 mt-2 shadow-lg'>
              <h3 className='text-lg font-bold text-gray-900 mb-2'>
                🎉 <span className='text-green-600'>Rejoice!</span>
              </h3>
              <p className='text-sm text-gray-700 mb-2'>
                You saved about{' '}
                <span className='font-semibold text-green-600'>
                  {dataToUse.meta.estimatedTimeSavedMinutes} minutes
                </span>{' '}
                catching up on {dataToUse.meta.totalMessages} messages in {dataToUse.cards.length}{' '}
                channels.
              </p>
              <p className='text-xs text-gray-500'>Time well spent! ✨</p>
            </div>
          )}
        </div>
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
                {selectedDate && (
                  <button
                    onClick={handleBackToCurrent}
                    className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                    title='Back to today'
                    data-track-category='RECAP_PANEL'
                    data-track-name='BACK_TO_TODAY'
                  >
                    <ChevronLeft size={18} />
                  </button>
                )}
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
                  {/* Calendar Button with Dropdown */}
                  <div className='relative'>
                    <button
                      onClick={() => setShowCalendar(!showCalendar)}
                      className={`p-1.5 rounded-md transition-colors duration-200 ${
                        showCalendar
                          ? 'text-blue-500 bg-blue-500/10'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                      aria-label='View past recaps'
                      title='View past recaps'
                      data-track-category='RECAP_PANEL'
                      data-track-name='OPEN_CALENDAR'
                    >
                      <Calendar size={18} />
                    </button>

                    {/* Calendar Dropdown - positioned below the button */}
                    {showCalendar && (
                      <div className='absolute top-full mt-2 right-0 z-50 w-[300px]'>
                        <div className='bg-background rounded-xl shadow-2xl border border-border overflow-hidden'>
                          <RecapCalendarView
                            onDateSelect={dateStr => {
                              const todayStr = getTodayDateStr();
                              if (dateStr === null || dateStr === todayStr) {
                                handleBackToCurrent();
                              } else {
                                void handleSelectDate(dateStr);
                              }
                              setShowCalendar(false);
                            }}
                            selectedDate={selectedDate}
                            onClose={() => setShowCalendar(false)}
                          />
                        </div>
                      </div>
                    )}
                  </div>

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

      {/* Click outside handler for calendar dropdown */}
      {showCalendar && (
        <div
          className='fixed inset-0 z-40'
          onClick={() => setShowCalendar(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setShowCalendar(false);
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
