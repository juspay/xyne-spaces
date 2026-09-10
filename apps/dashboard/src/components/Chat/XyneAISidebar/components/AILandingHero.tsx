import { logger, Event as LogEvent } from '../../../../utils/logger';
import {
  Component,
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactElement,
  type ReactNode,
} from 'react';
import { format, subDays, startOfDay } from 'date-fns';
import { CallStatus } from '@xyne/shared';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useAuth } from '../../../../hooks/useAuth';
import { usePlatform } from '../../../../hooks/usePlatform';
import { useCallHistory } from '../../../../routes/CallHistoryScreen/useCallHistory';
import { UpcomingCallsList } from '../../../Call/UpcomingCallsList';
import { RecapCardsList } from './RecapCardsList';
import type { Call } from '../../../../routes/CallHistoryScreen/callHistoryItem.utils';
import { useRecapData } from '../../../../hooks/useRecapData';
import { cn } from '../../../../utils/classNames';
import { Dialog } from '../../../ui/Dialog';
import { RecapPanel } from '../../../RecapPanel';
import type { RecapCard } from '../../../RecapPanel/RecapPanel.types';
import { xyneAIActor, type ThreadInfo } from '../../../../machines/xyneAIMachine';
import { XyneAIStar } from '../../../icons/xyne-ai';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

interface AILandingHeroProps {
  renderInput?: ReactNode;
  className?: string;
}

export const AILandingHero = ({ renderInput, className }: AILandingHeroProps): ReactElement => {
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const { calls, scheduledCalls, handleCallRowClick } = useCallHistory(user?.id);
  const {
    recapData,
    isFirstTime,
    unreadCount,
    isLoading: isRecapLoading,
    subscriptions,
  } = useRecapData();

  const navigate = useNavigate();
  const [isRecapModalOpen, setIsRecapModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<RecapCard | null>(null);

  // Mirrors RecapPanel.handleCitationClick — navigates to the cited message
  const handleRecapCitationClick = useCallback(
    (
      channelId: string,
      pointNumber: number,
      pointCitations: RecapCard['pointCitations'],
      drilldown: RecapCard['drilldown'],
    ): void => {
      setSelectedCard(null);
      const pointKey = String(pointNumber);
      const pointCitation = pointCitations?.[pointKey];
      const messageId = pointCitation?.messageId ?? drilldown?.messageId ?? undefined;
      const conversationId =
        pointCitation?.conversationId ?? drilldown?.conversationId ?? undefined;

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
    },
    [isMobile, navigate],
  );

  const buildAskAIThreadInfo = useCallback((card: RecapCard): ThreadInfo | null => {
    const firstCitation = Object.values(card.pointCitations ?? {}).find(
      citation => citation.conversationId,
    );
    const conversationId =
      firstCitation?.conversationId ?? card.drilldown.conversationId ?? undefined;
    if (!conversationId) return null;

    const messageId = firstCitation?.messageId ?? card.drilldown.messageId ?? undefined;
    return {
      conversationId,
      channelId: card.channelId,
      senderName: card.channelName,
      previewText: `${card.channelName} recap reference`,
      ...(messageId && { messageId }),
      isThreadMessage: true,
    };
  }, []);

  const handleAskAIAboutRecapReference = useCallback(
    (card: RecapCard): void => {
      const threadInfo = buildAskAIThreadInfo(card);
      if (!threadInfo) return;
      setSelectedCard(null);
      xyneAIActor.send({
        type: 'OPEN',
        channelId: card.channelId,
        threadInfo,
        startFreshChat: true,
      });
    },
    [buildAskAIThreadInfo],
  );

  const greeting = getGreeting();
  const formattedDate = getFormattedDate();

  const today = new Date();
  const yesterday = subDays(today, 1);
  // Timestamp for the start of yesterday — used to determine which recap channels are unread
  const yesterdayStart = startOfDay(yesterday).getTime();

  const showRecapWidget = !isFirstTime && !isRecapLoading && recapData?.configured === true;

  // Only show cards the user hasn't seen yet (lastSeenRecapDate is null or before yesterday)
  const unreadCards = (recapData?.cards ?? []).filter(card => {
    const sub = subscriptions.find(s => s.channelId === card.channelId);
    if (!sub) return false;
    return !sub.lastSeenRecapDate || sub.lastSeenRecapDate < yesterdayStart;
  });

  const upcomingCalls = useMemo(() => {
    const todayDate = new Date();
    const todaysCalls = new Map<string, Call>();

    for (const call of scheduledCalls ?? []) {
      todaysCalls.set(call.id, call as Call);
    }

    for (const call of calls ?? []) {
      todaysCalls.set(call.id, call);
    }

    return [...todaysCalls.values()]
      .filter(call => {
        if (!call.startsAt) return false;
        if (call.status === CallStatus.ENDED || call.status === CallStatus.CANCELLED) {
          return false;
        }

        const callDate = new Date(call.startsAt);
        return (
          callDate.getFullYear() === todayDate.getFullYear() &&
          callDate.getMonth() === todayDate.getMonth() &&
          callDate.getDate() === todayDate.getDate()
        );
      })
      .sort((a, b) => {
        const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
        const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
        return aTime - bTime;
      });
  }, [calls, scheduledCalls]);
  const callCount = upcomingCalls.length;

  const callsScrollRef = useRef<HTMLDivElement>(null);
  const [callsShowTopFade, setCallsShowTopFade] = useState(false);
  const [callsShowBottomFade, setCallsShowBottomFade] = useState(false);

  const updateCallsFades = useCallback(() => {
    const el = callsScrollRef.current;
    if (!el) return;
    setCallsShowTopFade(el.scrollTop > 4);
    setCallsShowBottomFade(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    updateCallsFades();
  }, [upcomingCalls, updateCallsFades]);

  const hasWidgets = callCount > 0 || (showRecapWidget && recapData !== null);

  return (
    <div
      data-slot='ai-landing-hero'
      className={cn(
        'relative flex flex-col',
        isMobile ? 'min-h-full overflow-visible' : 'h-full overflow-hidden',
        className,
      )}
    >
      {/* Background: cloud/sky image fading to white (matches Figma node 8110:79100). Hidden in midnight mode via CSS. */}
      <div
        aria-hidden='true'
        className='ai-landing-bg pointer-events-none absolute inset-0 opacity-60'
      >
        <div className='absolute inset-0 overflow-hidden opacity-70'>
          <img
            alt=''
            src='/images/xyne_ai_background.png'
            className='absolute left-0 w-full'
            style={{ top: '-19.14%', height: '108.01%' }}
          />
        </div>
        <div className='absolute inset-0 bg-gradient-to-b from-transparent to-white' />
      </div>

      {/* Hero section stays centered on desktop and becomes a normal stacked flow on phones. */}
      <div
        className={cn(
          'relative z-20 flex flex-col items-center',
          isMobile ? 'px-4 pt-6 pb-4' : 'flex-1 min-h-0 justify-center px-8 py-10',
        )}
      >
        <div className='flex w-full max-w-[680px] flex-col items-center gap-5 sm:gap-7'>
          {/* Greeting — matches Figma node 8110:79102 */}
          <div className='text-center'>
            <h1 className="text-[24px] font-medium leading-[normal] tracking-[-0.48px] text-foreground font-['Inter']">
              {greeting}
            </h1>
            <p className='mt-2 text-[16px] leading-[normal] text-foreground'>{formattedDate}</p>
          </div>

          {/* Search bar */}
          {renderInput && <div className='w-full'>{renderInput}</div>}

          {/* Disclaimer */}
          <p className='max-w-[28rem] text-center text-[11px] text-muted-foreground/40'>
            Xyne AI can make mistakes, please double-check responses.
          </p>
        </div>
      </div>

      {/* Widgets stack on phones instead of forcing a desktop split layout. */}
      {hasWidgets && (
        <div
          className={cn(
            'relative z-10 shrink-0 animate-in slide-in-from-bottom-4 fade-in duration-300',
            isMobile ? 'px-4 pt-4' : 'px-12 pt-8 pb-10',
          )}
        >
          <div className={cn('items-start', isMobile ? 'flex flex-col gap-6' : 'flex gap-16')}>
            {/* Left: Recap widget */}
            {showRecapWidget && recapData && (
              <div
                className={cn(
                  'min-w-0 flex flex-col',
                  isMobile ? 'w-full gap-4' : 'flex-[3] gap-5',
                )}
              >
                {/* Header */}
                <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                  <p className='text-sm text-muted-foreground'>
                    {unreadCards.length > 0 ? (
                      <>
                        You have{' '}
                        <span className='font-medium text-foreground'>
                          {unreadCount} unread {unreadCount === 1 ? 'recap' : 'recaps'}
                        </span>{' '}
                        from yesterday
                      </>
                    ) : (
                      <>Yesterday&apos;s recaps &mdash; all caught up</>
                    )}
                  </p>
                  <button
                    type='button'
                    onClick={() => void navigate('/chat/dir/recap')}
                    className='self-start text-xs text-primary hover:underline sm:ml-4 sm:shrink-0'
                    data-track-category='AILanding'
                    data-track-name='ViewAllRecaps'
                  >
                    View all
                  </button>
                </div>

                {/* Section label */}
                <p className='text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/50'>
                  Yesterday &middot; {format(yesterday, 'MMM d')}
                </p>

                {/* Unread recap cards */}
                {unreadCards.length > 0 && (
                  <RecapCardsList
                    cards={unreadCards}
                    isMobile={isMobile}
                    onView={card => setSelectedCard(card)}
                  />
                )}
              </div>
            )}

            {/* Right: Calls widget */}
            {callCount > 0 && (
              <div
                className={cn(
                  'min-w-0 flex flex-col',
                  isMobile ? 'w-full gap-4' : 'flex-[2] gap-5',
                )}
              >
                {/* Header */}
                <p className='text-sm text-muted-foreground'>
                  You have{' '}
                  <span className='font-medium text-foreground'>
                    {callCount} {callCount === 1 ? 'event' : 'events'}
                  </span>{' '}
                  planned for today
                </p>

                {/* Section label */}
                <p className='text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/50'>
                  Today &middot; {format(today, 'MMM d')}
                </p>

                {/* Calls list — scrollable */}
                <div className={cn('relative', isMobile ? '' : '')}>
                  {!isMobile && callsShowTopFade && (
                    <div className='absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-background to-transparent pointer-events-none z-10' />
                  )}
                  <div
                    ref={callsScrollRef}
                    onScroll={updateCallsFades}
                    className={cn(
                      isMobile
                        ? 'overflow-visible'
                        : 'max-h-[260px] overflow-y-auto scrollbar-none',
                    )}
                  >
                    <UpcomingCallsList
                      calls={upcomingCalls}
                      onJoinCall={call => handleCallRowClick(call)}
                    />
                  </div>
                  {!isMobile && callsShowBottomFade && (
                    <div className='absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none z-10' />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Focused single-channel recap preview */}
      <Dialog
        open={selectedCard !== null}
        onOpenChange={open => {
          if (!open) setSelectedCard(null);
        }}
        title={selectedCard ? `#${selectedCard.channelName} recap` : 'Recap'}
        className='max-w-sm rounded-2xl p-0'
      >
        {selectedCard && (
          <div className='flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between px-5 pt-5 pb-4'>
              <div className='flex items-center gap-2.5'>
                <div className='flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10'>
                  <span className='text-[11px] font-bold text-blue-500'>#</span>
                </div>
                <h2 className='text-sm font-semibold text-foreground'>
                  {selectedCard.channelName}
                </h2>
              </div>
              <button
                type='button'
                onClick={() => setSelectedCard(null)}
                className='flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground'
                aria-label='Close'
                data-track-category='AILanding'
                data-track-name='CloseRecapPreview'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            </div>

            {/* Bullet points with inline citation badges */}
            <ul className='flex flex-col gap-3 px-5 pb-5'>
              {selectedCard.summary.map((point, idx) => (
                <li key={idx} className='flex items-start'>
                  <span className='text-[13px] leading-relaxed text-foreground inline'>
                    <span className='mr-2 text-muted-foreground'>•</span>
                    <span
                      dangerouslySetInnerHTML={{
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        __html: DOMPurify.sanitize(
                          point.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                          { ALLOWED_TAGS: ['strong'] },
                        ),
                      }}
                    />
                    <button
                      type='button'
                      onClick={() =>
                        handleRecapCitationClick(
                          selectedCard.channelId,
                          idx + 1,
                          selectedCard.pointCitations,
                          selectedCard.drilldown,
                        )
                      }
                      className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
                      title={`View source for point ${idx + 1}`}
                      data-track-category='AILanding'
                      data-track-name='ViewRecapCitation'
                    >
                      {selectedCard.citationIndices?.[`${idx + 1}`] ?? idx + 1}
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            {/* Footer */}
            <div className='flex items-center justify-between border-t border-border px-5 py-3'>
              <span className='text-xs text-muted-foreground/60'>
                {selectedCard.messageCount} messages summarized
              </span>
              <div className='flex items-center gap-3'>
                {buildAskAIThreadInfo(selectedCard) && (
                  <button
                    type='button'
                    onClick={() => handleAskAIAboutRecapReference(selectedCard)}
                    className='inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline'
                    data-track-category='AILanding'
                    data-track-name='AskAIRecapReference'
                  >
                    <XyneAIStar size={13} />
                    Ask AI
                  </button>
                )}
                <button
                  type='button'
                  onClick={() => {
                    setSelectedCard(null);
                    void navigate('/chat/dir/recap');
                  }}
                  className='text-xs text-primary transition-colors hover:underline'
                  data-track-category='AILanding'
                  data-track-name='ViewAllFromRecapPreview'
                >
                  View all recaps
                </button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* Full recap panel modal — opened via "View all" */}
      <Dialog
        open={isRecapModalOpen}
        onOpenChange={setIsRecapModalOpen}
        title='Recap'
        className='max-w-3xl h-[80vh]'
      >
        <div className='h-[80vh]'>
          <RecapPanel />
        </div>
      </Dialog>
    </div>
  );
};

// ─── Error boundary ───────────────────────────────────────────────────────────
// Prevents a hook failure inside AILandingHero from crashing the entire XyneAISidebar.

interface AILandingHeroErrorBoundaryState {
  hasError: boolean;
}

export class AILandingHeroErrorBoundary extends Component<
  { children: ReactNode },
  AILandingHeroErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): AILandingHeroErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('AILandingHero failed to render:'),
      error: error,
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='flex-1 flex flex-col items-center justify-center gap-3 text-center px-8'>
          <p className='text-sm text-muted-foreground'>
            Something went wrong loading the AI assistant.
          </p>
          <button
            type='button'
            onClick={() => this.setState({ hasError: false })}
            className='text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors'
            data-track-category='AILanding'
            data-track-name='RetryAfterError'
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
