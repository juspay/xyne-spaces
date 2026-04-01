import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate, useParams, Outlet } from 'react-router-dom';
import {
  Settings,
  Sparkles,
  Clock,
  Hash,
  X,
  CheckCircle,
  Mail,
  MailOpen,
  CheckCheck,
} from 'lucide-react';
import { useRecapData } from '../../hooks/useRecapData';
import { RecapSubscription, RecapCard } from './RecapPanel.types';
import { getYesterdayIST, formatRecapDate } from './RecapPanel.utils';
import RecapSettings from './RecapSettings';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { usePlatform } from '../../hooks/usePlatform';

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

  // Show right panel when a cited thread is open
  const showThreadPanel = !!params.channelId;

  // Use the cached recap data hook
  const { recapData, subscriptions, isLoadingSubscriptions, isFirstTime } = useRecapData();

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Track if user just saved their first channel selection
  // This helps us show the loading state while Zero syncs
  const [justSavedFirstTime, setJustSavedFirstTime] = useState(false);

  // State
  const [markedAsReadChannels, setMarkedAsReadChannels] = useState<Set<string>>(new Set());

  // Stable random greeting for this session
  const [greeting] = useState(() => getRandomGreeting());

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

  // Split cards into unread and read sections (moved up to be used in handleMarkAllAsRead)
  const { unreadCards, readCards } = useMemo(() => {
    if (!recapData) {
      return { unreadCards: [], readCards: [] };
    }

    const unread: RecapCard[] = [];
    const read: RecapCard[] = [];

    for (const card of recapData.cards) {
      if (markedAsReadChannels.has(card.channelId)) {
        read.push(card);
      } else {
        unread.push(card);
      }
    }

    return { unreadCards: unread, readCards: read };
  }, [recapData, markedAsReadChannels]);

  // Handle settings open/close
  const handleOpenSettings = useCallback((): void => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback((): void => {
    setIsSettingsOpen(false);
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
  }, [unreadCards.length, zero]);

  // Handle when settings is saved - track if this was a first-time save
  const handleSettingsSaved = useCallback((): void => {
    // If this was a first-time save, track it so we show loading while Zero syncs
    if (isFirstTime) {
      setJustSavedFirstTime(true);
    }
    setIsSettingsOpen(false);
  }, [isFirstTime]);

  // Handle citation click - open channel view in right panel while keeping recap visible
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

    // Both mobile and desktop: open channel view with #origin to auto-scroll to the citation
    // Mobile navigates to /chat/dir/:channelId (full screen); desktop uses split recap route
    if (conversationId && messageId) {
      const hash = `#origin=${conversationId}&messageId=${messageId}`;
      void navigate(
        isMobile ? `/chat/dir/${channelId}${hash}` : `/chat/dir/recap/${channelId}${hash}`,
      );
    } else if (conversationId) {
      const hash = `#origin=${conversationId}`;
      void navigate(
        isMobile ? `/chat/dir/${channelId}${hash}` : `/chat/dir/recap/${channelId}${hash}`,
      );
    } else {
      void navigate(isMobile ? `/chat/dir/${channelId}` : `/chat/dir/recap/${channelId}`);
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
        }
        // Zero will auto-sync the subscriptions, no need to refresh
      } catch (error) {
        console.error('Error toggling read status:', error);
      }
    },
    [zero],
  );

  // Render recap cards content (left/center panel)
  const renderRecapCards = (): ReactElement => {
    if (!recapData || recapData.cards.length === 0) {
      return (
        <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
          <Clock className='text-muted-foreground mb-4' size={48} />
          <p className='text-muted-foreground text-lg font-medium'>
            Nothing important happened yesterday.
          </p>
          <p className='text-xs text-muted-foreground/60 text-center mt-4'>
            This tool uses AI to generate responses, so some information may be inaccurate.
          </p>
        </div>
      );
    }

    // Render a single recap card
    const renderCard = (card: RecapCard): ReactElement => {
      const isRead = markedAsReadChannels.has(card.channelId);
      return (
        <div
          className={`border rounded-xl p-5 bg-card shadow-sm mb-5 transition-all duration-300 hover:shadow-md ${
            isRead
              ? 'border-l-[3px] border-l-green-500 border-border'
              : 'border-l-[3px] border-l-blue-500 border-border'
          }`}
        >
          {/* Card header: channel name */}
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-2 text-foreground font-semibold text-base'>
              <Hash size={16} className='text-muted-foreground' />
              <span>{card.channelName}</span>
            </div>
          </div>

          {/* Summary points */}
          <div className='mb-5'>
            <ul className='space-y-2'>
              {card.summary.map((point: string, idx: number) => (
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
                          card.pointCitations,
                          card.drilldown,
                        )
                      }
                      className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
                      title={`View source for point ${idx + 1}`}
                      data-track-category='RECAP_PANEL'
                      data-track-name='CLICK_CITATION'
                    >
                      {card.citationIndices?.[`${idx + 1}`] ?? idx + 1}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Card footer */}
          <div className='flex items-center justify-between pt-4 border-t border-border'>
            <span className={`text-muted-foreground ${isMobile ? 'text-xs' : 'text-sm'}`}>
              {card.messageCount} {isMobile ? 'messages' : 'messages summarized'}
            </span>
            <button
              onClick={() => void handleToggleRead(card.channelId, isRead)}
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors px-2.5 py-1 rounded-md border ${
                isRead
                  ? 'border-blue-500/30 text-blue-600 hover:bg-blue-500/10'
                  : 'border-green-500/30 text-green-600 hover:bg-green-500/10'
              }`}
              data-track-category='RECAP_PANEL'
              data-track-name={isRead ? 'MARK_AS_UNREAD' : 'MARK_AS_READ'}
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
            {greeting}
          </h2>
          <p className='text-sm text-muted-foreground'>
            Recapping {recapData.meta.totalMessages} messages from {formatRecapDate(recapData.date)}
          </p>
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
                <button
                  onClick={handleMarkAllAsRead}
                  className='flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-green-600 bg-green-500/10 hover:bg-green-500/20 rounded-md border border-green-500/30 transition-colors'
                  title='Mark all as read'
                  data-track-category='RECAP_PANEL'
                  data-track-name='MARK_ALL_AS_READ'
                >
                  <CheckCheck size={12} />
                  <span>Mark all as read</span>
                </button>
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
                'Read Recap',
                readCards.length,
                <MailOpen size={16} className='text-green-500' />,
              )}
              {readCards.map(card => (
                <div key={card.channelId}>{renderCard(card)}</div>
              ))}
            </div>
          )}

          {/* Footer with time saved - enhanced with gradient */}
          {recapData.meta.estimatedTimeSavedMinutes > 0 && (
            <div className='rounded-2xl p-6 text-center bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-2 border-green-200 mb-5 mt-2 shadow-lg'>
              <h3 className='text-lg font-bold text-gray-900 mb-2'>
                🎉 <span className='text-green-600'>Rejoice!</span>
              </h3>
              <p className='text-sm text-gray-700 mb-2'>
                You saved about{' '}
                <span className='font-semibold text-green-600'>
                  {recapData.meta.estimatedTimeSavedMinutes} minutes
                </span>{' '}
                catching up on {recapData.meta.totalMessages} messages in {recapData.cards.length}{' '}
                channels.
              </p>
              <p className='text-xs text-gray-500'>Time well spent! ✨</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Show channel selection for first-time users - show welcome screen with button
  if (isFirstTime && !isLoadingSubscriptions) {
    return (
      <>
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
        <RecapSettings
          isOpen={isSettingsOpen}
          onClose={handleCloseSettings}
          onSaved={handleSettingsSaved}
        />
      </>
    );
  }

  // Main content — split when channel panel is open
  return (
    <>
      <div className='flex h-full bg-background'>
        {/* Left: Recap cards (always visible) */}
        <div
          className={`flex flex-col ${showThreadPanel ? 'w-1/2' : 'w-full'} border-r border-border bg-background`}
        >
          {/* Header */}
          <div className='p-4 bg-background border-b border-border flex-shrink-0'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h3 className='font-bold text-foreground text-xl'>Recap</h3>
                <Sparkles size={20} className='text-blue-500' />
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
          </div>

          {/* Scrollable recap cards */}
          <div className='flex-1 overflow-hidden bg-muted/30'>{renderRecapCards()}</div>
        </div>

        {/* Right: Channel view panel (visible when citation is clicked) */}
        {showThreadPanel && (
          <div className='w-1/2 flex flex-col h-full relative bg-background'>
            <button
              onClick={handleCloseThreadPanel}
              className='absolute top-2 right-2 z-50 p-2 bg-background rounded-lg shadow-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
              aria-label='Close'
              data-track-category='RECAP_PANEL'
              data-track-name='CLOSE_THREAD_PANEL'
            >
              <X size={18} />
            </button>
            <div className='flex-1 h-full overflow-hidden'>
              <Outlet />
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
    </>
  );
};

export default RecapPanel;
