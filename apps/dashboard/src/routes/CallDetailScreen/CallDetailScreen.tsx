import { ReactElement, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, FileText } from 'lucide-react';
import { recordingService } from '../../services/Recording/recordingService';
import { AudioPlayer } from '../../components/ui/AudioPlayer/AudioPlayer';
import { useCallPRD } from '../../hooks/useCallPRD';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import { type Call } from '../CallHistoryScreen/callHistoryItem.utils';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { usePlatform } from '../../hooks/usePlatform';
import { DetailedSummaryCanvasTab } from './DetailedSummaryCanvasTab';
import { PrdCanvasTab } from './PrdCanvasTab';
import { CallParticipantsPopover } from './CallParticipantsPopover';
import { CallSummaryTemplatePicker } from './CallSummaryTemplatePicker';
import { useAuth } from '../../hooks/useAuth';
import { useAllChannels, useAllVisibleChannels } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { formatCallHeldOn, formatCallLength } from './CallDetailScreen.utils';

let _userClosedAIForCallId: string | null = null;

const getCanvasIdFromUrl = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  return url.split('/').filter(Boolean).pop() ?? null;
};

export default function CallDetailScreen(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const call = (location.state as { call: Call } | null)?.call;
  const { isMobile } = usePlatform();

  // Hoist derived values so they're available to all hooks below
  const callConversationId =
    (call?.metadata as { conversationId?: string } | null)?.conversationId ?? null;

  const [activeTab, setActiveTab] = useState<string>('detailed-summary');
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const { user } = useAuth();

  const isAIOpen = useSelector(xyneAIActor, state => !state.matches('closed'));
  const allChannels = useAllChannels();
  const visibleChannels = useAllVisibleChannels();
  const isChannelMember = visibleChannels.some(c => c.id === call?.channelId);
  const channel = allChannels.find(c => c.id === call?.channelId);
  const { displayName: channelDisplayName, isLoading: isChannelNameLoading } =
    useChannelDisplayName(channel, user?.id ?? '');

  // Set call context on the AI sidebar so it's scoped to this call when opened
  useAskAiTicketContext({
    channelId: call?.channelId ?? null,
    conversationId: callConversationId,
    previewText: call?.title ?? 'Call',
  });

  const [conversationMessages] = useCachedQuery(
    queries.conversationMessages({ conversationId: callConversationId ?? '' }),
    { enabled: !!callConversationId },
  );
  const persistedPrdCanvasIds = useMemo<string[]>(() => {
    if (!conversationMessages || !call?.externalId) return [];
    return conversationMessages.flatMap(m => {
      const meta = m.metadata as Record<string, unknown> | null;
      if (meta?.['messageSubtype'] !== 'call_prd') return [];
      if (meta?.['callId'] !== call.externalId) return [];
      const url = typeof meta['canvasUrl'] === 'string' ? meta['canvasUrl'] : null;
      const id = url ? (url.split('/').pop() ?? null) : null;
      return id ? [id] : [];
    });
  }, [conversationMessages, call?.externalId]);

  const callMessage = useMemo(() => {
    if (!conversationMessages || !call?.externalId) return null;
    return (
      conversationMessages.find(msg => {
        const meta = msg.metadata as Record<string, unknown> | null;
        return meta?.['isCallMessage'] === true && meta?.['callId'] === call.externalId;
      }) ?? null
    );
  }, [conversationMessages, call?.externalId]);

  const callMessageId = callMessage?.messageId ?? null;

  const detailedSummaryCanvasId = useMemo<string | null>(() => {
    const meta = callMessage?.metadata as Record<string, unknown> | null | undefined;
    return getCanvasIdFromUrl(meta?.['detailedSummaryCanvasUrl']);
  }, [callMessage]);

  const hasDetailedSummaryTab = Boolean(detailedSummaryCanvasId);

  const hasRecording = useMemo<boolean>(() => {
    if (!conversationMessages || !call?.externalId) return false;
    return conversationMessages.some(m =>
      (m.attachments ?? []).some(a => {
        const meta = a.metadata as Record<string, unknown> | null;
        return meta?.['type'] === 'recording' && meta?.['callId'] === call.externalId;
      }),
    );
  }, [conversationMessages, call?.externalId]);

  const durationMs =
    call?.startedAt && call?.endedAt
      ? new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()
      : null;

  const { prdEntries } = useCallPRD({
    externalId: call?.externalId ?? '',
    messageId: callMessageId,
    persistedPrdCanvasIds,
    onTabCreate: setActiveTab,
  });

  const updateScrollButtons = (): void => {
    const el = tabScrollRef.current;
    if (!el) return;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    const hasOverflow = maxScrollLeft > 1;
    setCanScrollLeft(hasOverflow && el.scrollLeft > 1);
    setCanScrollRight(hasOverflow && el.scrollLeft < maxScrollLeft - 1);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollButtons);
    return () => window.cancelAnimationFrame(frame);
  }, [hasDetailedSummaryTab, prdEntries.length]);

  const aiOpenedRef = useRef(false);

  // Single source of truth for opening the AI sidebar — used by both the mount
  // effect and the "Ask AI" button so the payload isn't duplicated.
  const openAI = useCallback((): void => {
    if (!call) return;
    _userClosedAIForCallId = null;
    xyneAIActor.send({
      type: 'OPEN',
      ...(call.channelId ? { channelId: call.channelId } : {}),
      threadInfo: callConversationId
        ? { conversationId: callConversationId, previewText: call.title ?? 'Call' }
        : null,
      startFreshChat: true,
    });
    aiOpenedRef.current = true;
  }, [call, callConversationId]);

  useEffect(() => {
    if (!call || isMobile) return;
    if (_userClosedAIForCallId === call.id) {
      _userClosedAIForCallId = null;
      return;
    }
    const subscription = xyneAIActor.subscribe(state => {
      if (state.matches('closed') && aiOpenedRef.current) {
        _userClosedAIForCallId = call.id;
        aiOpenedRef.current = false;
      }
    });
    openAI();
    return (): void => {
      subscription.unsubscribe();
      xyneAIActor.send({ type: 'CLOSE' });
      aiOpenedRef.current = false;
    };
  }, [call, isMobile, openAI]);

  const title = call?.title ?? 'Untitled Call';
  const heldOn = formatCallHeldOn(call?.startedAt);
  const callLength = formatCallLength(durationMs);

  if (!call) {
    return (
      <div className='flex items-center justify-center h-full'>
        <p className='text-sm text-muted-foreground'>
          Call not found. Please go back and try again.
        </p>
      </div>
    );
  }
  const callUpdatesChannelId = call.callUpdatesChannel ?? call.channelId;
  const hasCallMessageLink = Boolean(call.channelId && callConversationId);
  // While a DM's participants are still loading the hook reports "Unknown User",
  // so fall back to the neutral label rather than flashing a wrong name.
  const postedInLabel =
    channel && channelDisplayName && !isChannelNameLoading
      ? `Posted in #${channelDisplayName}`
      : 'Go to message';

  const handleGotoCallMessage = (): void => {
    if (!callUpdatesChannelId || !callConversationId) return;
    void navigate(
      `/chat/dir/${callUpdatesChannelId}/${callConversationId}#origin=${callConversationId}`,
    );
  };

  const pillClassName = (isActive: boolean): string =>
    cn(
      'flex items-center gap-1.5 shrink-0 h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
      isActive
        ? 'border-border bg-accent text-foreground'
        : cn(
            'border-transparent text-muted-foreground',
            !isMobile && 'hover:bg-accent/60 hover:text-foreground',
          ),
    );

  return (
    <div className='flex h-full overflow-hidden bg-background rounded-2xl'>
      <div className='flex-1 flex flex-col overflow-hidden min-w-0'>
        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto w-full max-w-[820px] px-6 pt-6 pb-24 sm:px-8'>
            {/* Breadcrumb + Ask AI */}
            <div className='flex items-center gap-[7px] mb-[18px]'>
              <button
                onClick={() => void navigate('..')}
                data-track-category='CallDetail'
                data-track-name='breadcrumb-calls'
                className='text-[13px] text-muted-foreground hover:text-foreground transition-colors shrink-0'
              >
                Calls Home
              </button>
              <span className='text-[13px] text-muted-foreground/60 shrink-0'>/</span>
              <Tooltip content={title} delayDuration={500}>
                <span className='min-w-0 truncate text-[13px] font-medium text-foreground/85'>
                  {title}
                </span>
              </Tooltip>
              <div className='flex-1' />
              {!isAIOpen && !isMobile && (
                <Tooltip content='Ask AI' delayDuration={300}>
                  <button
                    onClick={openAI}
                    data-track-category='CallDetail'
                    data-track-name='open-ask-ai'
                    className='size-8 shrink-0 flex items-center justify-center rounded-lg transition-colors hover:bg-accent'
                  >
                    <img
                      alt='Ask AI'
                      width='18'
                      height='18'
                      src='/svgs/icons/ai-bot-gradient-star.svg'
                    />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* Title */}
            <h1 className='text-[31px] font-semibold leading-[1.15] tracking-[-0.5px] text-foreground'>
              {title}
            </h1>

            {/* Meta line: date · time · length · posted in */}
            <div className='mt-2 flex flex-wrap items-center gap-x-[9px] gap-y-1 text-[13.5px] text-muted-foreground'>
              {heldOn && <span>{heldOn}</span>}
              {heldOn && callLength && <span className='text-muted-foreground/60'>·</span>}
              {callLength && <span>{callLength}</span>}
              {hasCallMessageLink && (heldOn || callLength) && (
                <span className='text-muted-foreground/60'>·</span>
              )}
              {hasCallMessageLink && (
                <Tooltip
                  content={
                    isChannelMember
                      ? 'Open the call message'
                      : 'You are not a member of this channel'
                  }
                  delayDuration={300}
                >
                  <span className='inline-flex min-w-0 max-w-full'>
                    <button
                      onClick={handleGotoCallMessage}
                      disabled={!isChannelMember}
                      data-track-category='CallDetail'
                      data-track-name='goto-call-message'
                      className='truncate underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-muted-foreground disabled:pointer-events-none disabled:no-underline disabled:opacity-60'
                    >
                      {postedInLabel}
                    </button>
                  </span>
                </Tooltip>
              )}
            </div>

            {/* Participants */}
            <CallParticipantsPopover call={call} currentUserId={user?.id} className='mt-3.5' />

            {/* Recording */}
            {hasRecording && (
              <div className='mt-3.5 max-w-md rounded-xl border border-border bg-muted/40 px-3 py-2'>
                <AudioPlayer
                  onLoad={signal => recordingService.downloadRecordingBlob(call.externalId, signal)}
                  initialDurationSec={durationMs ? durationMs / 1000 : undefined}
                  trackCategory='CallDetail'
                  showToastOnError
                />
              </div>
            )}

            {/* Tabs + primary action */}
            <div className='mt-3.5 flex items-center gap-2.5 border-b border-border pb-3'>
              {canScrollLeft && (
                <button
                  onClick={() => {
                    tabScrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
                    updateScrollButtons();
                  }}
                  data-track-category='CallDetail'
                  data-track-name='tabs-scroll-left'
                  className='shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                >
                  <ChevronLeft className='size-3.5' />
                </button>
              )}
              <div
                ref={tabScrollRef}
                onScroll={updateScrollButtons}
                className='flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar'
              >
                {hasDetailedSummaryTab && (
                  <CallSummaryTemplatePicker
                    selectedTemplateId={call.summaryTemplateId}
                    isActive={activeTab === 'detailed-summary'}
                    onSelect={() => setActiveTab('detailed-summary')}
                    className={pillClassName(activeTab === 'detailed-summary')}
                  />
                )}
                {prdEntries.map(prd => (
                  <button
                    key={prd.id}
                    onClick={() => setActiveTab(prd.id)}
                    data-track-category='CallDetail'
                    data-track-name='tab-prd'
                    className={cn(pillClassName(activeTab === prd.id), 'max-w-[160px]')}
                  >
                    {prd.canvasId === null ? (
                      <Loader2 className='size-3.5 shrink-0 animate-spin' />
                    ) : (
                      <FileText className='size-3.5 shrink-0' />
                    )}
                    <span className='truncate'>{prd.title}</span>
                  </button>
                ))}
              </div>
              {canScrollRight && (
                <button
                  onClick={() => {
                    tabScrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' });
                    updateScrollButtons();
                  }}
                  data-track-category='CallDetail'
                  data-track-name='tabs-scroll-right'
                  className='shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                >
                  <ChevronRight className='size-3.5' />
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className='w-full pt-6'>
              {activeTab === 'detailed-summary' && detailedSummaryCanvasId ? (
                <DetailedSummaryCanvasTab canvasId={detailedSummaryCanvasId} />
              ) : (
                (() => {
                  const prd = prdEntries.find(e => e.id === activeTab);
                  if (!prd) {
                    return (
                      <p className='text-sm text-muted-foreground'>
                        No detailed summary available for this call.
                      </p>
                    );
                  }
                  if (prd.canvasId === null) {
                    return (
                      <div className='flex flex-col gap-1.5'>
                        <p className='text-sm font-medium text-foreground'>Generating PRD...</p>
                        <p className='text-xs text-muted-foreground'>
                          Analyzing meeting transcript and extracting requirements
                        </p>
                      </div>
                    );
                  }
                  return <PrdCanvasTab canvasId={prd.canvasId} />;
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
