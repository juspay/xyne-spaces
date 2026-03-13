import { ReactElement, useState, useEffect, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate, useParams, Outlet } from 'react-router-dom';
import { Settings, Sparkles, Clock, Hash, CheckCircle, X, Check } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useRecapData } from '../../hooks/useRecapData';
import { CitationMetadata, RecapSubscription, RecapCard } from './RecapPanel.types';
import { getYesterdayIST, formatRecapDate } from './RecapPanel.utils';
import RecapSettings from './RecapSettings';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';

const RecapPanel = (): ReactElement => {
  const navigate = useNavigate();
  const params = useParams<{ channelId?: string; conversationId?: string }>();
  const zero = useZero();

  // Use the cached recap data hook
  const { recapData, subscriptions, isLoadingSubscriptions, isFirstTime } = useRecapData();

  // Check if we're showing the side panel (when channelId is present in URL)
  const showSidePanel = !!params.channelId;

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Track if user just saved their first channel selection
  // This helps us show the loading state while Zero syncs
  const [justSavedFirstTime, setJustSavedFirstTime] = useState(false);

  // State
  const [markedAsReadChannels, setMarkedAsReadChannels] = useState<Set<string>>(new Set());

  // Track if we've already auto-marked as read on initial open
  const hasAutoMarkedRead = useRef(false);

  // Auto-open settings modal for first-time users when they click "Choose Channels"
  // The modal is opened via handleOpenSettings

  // Reset justSavedFirstTime when subscriptions actually load
  useEffect(() => {
    if (justSavedFirstTime && subscriptions.length > 0) {
      setJustSavedFirstTime(false);
    }
  }, [justSavedFirstTime, subscriptions]);

  // Auto mark as read when panel opens with recap data
  // This marks all subscribed channels as seen for yesterday's recap
  // Only runs ONCE on initial open (tracked via ref to prevent re-triggering)
  useEffect(() => {
    if (
      !hasAutoMarkedRead.current &&
      !isFirstTime &&
      subscriptions.length > 0 &&
      recapData?.configured &&
      recapData.hasUnreadRecap
    ) {
      hasAutoMarkedRead.current = true;

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
    }
  }, [isFirstTime, subscriptions, recapData, zero]);

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

  // Handle settings open/close
  const handleOpenSettings = useCallback((): void => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback((): void => {
    setIsSettingsOpen(false);
  }, []);

  // Handle when settings is saved - track if this was a first-time save
  const handleSettingsSaved = useCallback((): void => {
    // If this was a first-time save, track it so we show loading while Zero syncs
    if (isFirstTime) {
      setJustSavedFirstTime(true);
    }
    setIsSettingsOpen(false);
  }, [isFirstTime]);

  // Handle citation click - navigate within recap route with message highlighting
  // Citations now contain messageId directly for precise linking to specific messages
  const handleCitationClick = (
    channelId: string,
    pointNumber: number,
    citations: Record<string, string[]>,
    messageIds: Record<string, string>,
    _channelName: string,
    drilldown?: { conversationId: string | null; messageId: string | null },
    citationMetadata?: CitationMetadata,
  ): void => {
    const pointKey = String(pointNumber);

    // Get citation values - these should be messageIds (from updated backend)
    const citationValues = citations[pointKey];
    const citedMessageId = citationValues?.[0];

    let messageId: string | undefined;
    let conversationId: string | undefined;

    // Step 1: If we have citationMetadata, look up the conversationId for this messageId
    if (citationMetadata && citedMessageId) {
      const convMapping = citationMetadata.conversationIdMapping;
      const msgMapping = citationMetadata.messageIdMapping;

      // Find the conversationId for this messageId
      for (const [idx, msgId] of Object.entries(msgMapping)) {
        if (msgId === citedMessageId) {
          const index = parseInt(idx, 10);
          conversationId = convMapping[index];
          messageId = citedMessageId;
          break;
        }
      }
    }

    // Step 2: Fallback to messageIds and drilldown
    if (!messageId) {
      messageId = messageIds[pointKey] || drilldown?.messageId || undefined;
    }
    if (!conversationId) {
      conversationId = drilldown?.conversationId || undefined;
    }

    if (!conversationId) {
      // No conversation ID - navigate to channel only within recap
      void navigate(`/chat/dir/recap/${channelId}`);
      return;
    }

    // Navigate to the thread with message highlighting - keeping recap panel open
    // The hash format enables auto-scroll and highlight: #origin=${conversationId}&messageId=${messageId}
    if (messageId) {
      void navigate(
        `/chat/dir/recap/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}`,
      );
    } else {
      void navigate(`/chat/dir/recap/${channelId}/${conversationId}#origin=${conversationId}`);
    }
  };

  // Close side panel - navigate back to recap root
  const handleCloseSidePanel = useCallback((): void => {
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
          <Clock className='text-gray-300 mb-4' size={48} />
          <p className='text-gray-500 text-lg font-medium'>Nothing important happened yesterday.</p>
          <p className='text-xs text-gray-400 text-center mt-4'>
            This tool uses AI to generate responses, so some information may be inaccurate.
          </p>
        </div>
      );
    }

    // Render a single recap card
    const renderCard = (card: RecapCard): ReactElement => (
      <div className='border border-gray-200 rounded-xl p-5 bg-white shadow-sm mb-5'>
        <div className='flex items-center gap-2 text-gray-700 font-semibold text-base mb-4'>
          <Hash size={16} />
          <span>{card.channelName}</span>
        </div>
        <div className='mb-5'>
          <ul className='space-y-2'>
            {card.summary.map((point: string, idx: number) => (
              <li key={idx} className='flex items-start'>
                <span className='text-gray-800 text-sm leading-relaxed font-normal inline'>
                  <span className='mr-2'>•</span>
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
                        card.citations,
                        card.messageIds,
                        card.channelName,
                        card.drilldown,
                        card.citationMetadata,
                      )
                    }
                    className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-gray-200 text-gray-700 font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-gray-300 transition-colors cursor-pointer align-middle"
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
        <div className='flex items-center justify-between pt-4 border-t border-gray-100'>
          <span className='text-sm text-gray-500'>{card.messageCount} messages summarized</span>
          <button
            onClick={() =>
              void handleToggleRead(card.channelId, markedAsReadChannels.has(card.channelId))
            }
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors px-3 py-1.5 rounded-lg ${
              markedAsReadChannels.has(card.channelId)
                ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            data-track-category='RECAP_PANEL'
            data-track-name={
              markedAsReadChannels.has(card.channelId) ? 'MARK_AS_UNREAD' : 'MARK_AS_READ'
            }
          >
            {markedAsReadChannels.has(card.channelId) ? (
              <>
                <Check size={16} className='text-green-600' />
                <span>Mark as unread</span>
              </>
            ) : (
              <>
                <CheckCircle size={16} className='text-gray-500' />
                <span>Mark as read</span>
              </>
            )}
          </button>
        </div>
      </div>
    );

    return (
      <div className='h-full flex flex-col'>
        {/* Header Section - fixed at top */}
        <div className='text-center p-5 pb-4 flex-shrink-0'>
          <h2 className='text-2xl font-semibold text-gray-900 mb-1'>Pleasant perusing 🙌</h2>
          <p className='text-sm text-gray-600'>
            Recapping {recapData.meta.totalMessages} messages from {formatRecapDate(recapData.date)}
          </p>
        </div>

        {/* Virtuoso scrollable area */}
        <div className='flex-1 min-h-0 px-5 pb-6'>
          <Virtuoso
            data={recapData.cards}
            computeItemKey={(_, card) => card.channelId}
            overscan={200}
            increaseViewportBy={{ top: 200, bottom: 300 }}
            itemContent={(_, card) => renderCard(card)}
            components={{
              Footer: () =>
                recapData.meta.estimatedTimeSavedMinutes > 0 ? (
                  <div className='border-2 border-black-500 rounded-2xl p-6 text-center bg-white mb-5 mt-2'>
                    <h3 className='text-lg font-bold text-gray-900 mb-2'>Rejoice!</h3>
                    <p className='text-sm text-gray-700 mb-4'>
                      You saved about {recapData.meta.estimatedTimeSavedMinutes} minutes catching up
                      on {recapData.meta.totalMessages} messages in {recapData.cards.length}{' '}
                      channels.
                    </p>
                  </div>
                ) : null,
            }}
          />
        </div>
      </div>
    );
  };

  // Show channel selection for first-time users - show welcome screen with button
  if (isFirstTime && !isLoadingSubscriptions) {
    return (
      <>
        <div className='flex flex-col items-center justify-center h-full p-8 text-center bg-white'>
          <Clock className='text-gray-300 mb-4' size={48} />
          <h2 className='text-xl font-semibold text-gray-900 mb-2'>
            Use AI recaps to focus in — without missing out
          </h2>
          <p className='text-gray-500 text-sm mb-6 max-w-md'>
            Get daily AI-powered summaries of conversations across your selected channels,
            highlighting key discussions, decisions, and important information.
          </p>
          <button
            onClick={handleOpenSettings}
            className='px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200 font-medium cursor-pointer'
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

  // Main content - split layout when side panel is shown
  return (
    <>
      <div className='flex flex-col h-full bg-white'>
        {/* Header */}
        <div className='p-4 bg-white border-b'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <h3 className='font-bold text-gray-900 text-xl'>Recap</h3>
              <Sparkles size={20} className='text-blue-500' />
            </div>
            <button
              onClick={handleOpenSettings}
              className='p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200'
              aria-label='Settings'
              title='Manage channels'
              data-track-category='RECAP_PANEL'
              data-track-name='OPEN_SETTINGS'
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Split content area */}
        <div className='flex-1 flex overflow-hidden'>
          {/* Left: Recap cards panel */}
          <div
            className={`${showSidePanel ? 'w-1/2 border-r border-gray-200' : 'w-full'} min-w-0 bg-slate-50`}
          >
            {renderRecapCards()}
          </div>

          {/* Right: Side panel for cited thread */}
          {showSidePanel && (
            <div className='w-1/2 bg-white flex flex-col h-full relative'>
              {/* Close button overlay */}
              <button
                onClick={handleCloseSidePanel}
                className='absolute top-2 right-2 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors'
                aria-label='Close'
                data-track-category='RECAP_PANEL'
                data-track-name='CLOSE_SIDE_PANEL'
              >
                <X size={18} />
              </button>

              {/* Thread/Conversation View - renders via Outlet */}
              <div className='flex-1 h-full overflow-hidden'>
                <Outlet />
              </div>
            </div>
          )}
        </div>
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
