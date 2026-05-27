import { ReactElement, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Users,
  Music,
  ClipboardList,
  Loader2,
  LayoutList,
  MessageCircle,
  MessageSquare,
  FileText,
} from 'lucide-react';
import { recordingService } from '../../services/Recording/recordingService';
import { AudioPlayer } from '../../components/ui/AudioPlayer/AudioPlayer';
import { CreateDocumentModal } from '../../components/ui/MessageBubble/CreateDocumentModal';
import Avatar from '../../components/ui/Avatar/Avatar';
import { useUsers } from '../../hooks/useUsers';
import { useCallPRD } from '../../hooks/useCallPRD';
import { useAskAiTicketContext } from '../../hooks/useAskAiTicketContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';
import Tooltip from '../../components/ui/Tooltip/Tooltip';
import { type Call } from '../CallHistoryScreen/callHistoryItem.utils';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { usePlatform } from '../../hooks/usePlatform';
import { PrdCanvasTab } from './PrdCanvasTab';
import { TranscriptTab } from './TranscriptTab';

let _userClosedAIForCallId: string | null = null;

export default function CallDetailScreen(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const call = (location.state as { call: Call } | null)?.call;
  const { isMobile } = usePlatform();

  // Hoist derived values so they're available to all hooks below
  const callConversationId =
    (call?.metadata as { conversationId?: string } | null)?.conversationId ?? null;

  const [activeTab, setActiveTab] = useState<string>('summary');
  const [isPRDModalOpen, setIsPRDModalOpen] = useState(false);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const allUsers = useUsers();

  const isAIOpen = useSelector(xyneAIActor, state => !state.matches('closed'));

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

  const callMessageId = useMemo<string | null>(() => {
    if (!conversationMessages || !call?.externalId) return null;
    const m = conversationMessages.find(msg => {
      const meta = msg.metadata as Record<string, unknown> | null;
      return meta?.['isCallMessage'] === true && meta?.['callId'] === call.externalId;
    });
    return m?.messageId ?? null;
  }, [conversationMessages, call?.externalId]);

  const hasRecording = useMemo<boolean>(() => {
    if (!conversationMessages || !call?.externalId) return false;
    return conversationMessages.some(m =>
      (m.attachments ?? []).some(a => {
        const meta = a.metadata as Record<string, unknown> | null;
        return meta?.['type'] === 'recording' && meta?.['callId'] === call.externalId;
      }),
    );
  }, [conversationMessages, call?.externalId]);

  // Find the transcript attachment from Zero (matches the chat thread pattern in CallBubble).
  // Prefer the speaker-attributed "identified" transcript when present.
  const transcriptAttachmentId = useMemo<string | null>(() => {
    if (!conversationMessages || !call?.externalId) return null;
    const all = conversationMessages.flatMap(m => m.attachments ?? []);
    const matches = (type: string) =>
      all.find(a => {
        const meta = a.metadata as Record<string, unknown> | null;
        return meta?.['type'] === type && meta?.['callId'] === call.externalId;
      });
    return (matches('identified_transcript') ?? matches('transcript'))?.id ?? null;
  }, [conversationMessages, call?.externalId]);

  const durationMs =
    call?.startedAt && call?.endedAt
      ? new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()
      : null;

  const { prdEntries, handleGeneratePRD, isGeneratingPRD } = useCallPRD({
    externalId: call?.externalId ?? '',
    messageId: callMessageId,
    persistedPrdCanvasIds,
    onTabCreate: setActiveTab,
  });

  const updateScrollButtons = (): void => {
    const el = tabScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  useEffect(() => {
    updateScrollButtons();
  }, [prdEntries]);

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

  if (!call) {
    return (
      <div className='flex items-center justify-center h-full'>
        <p className='text-sm text-muted-foreground'>
          Call not found. Please go back and try again.
        </p>
      </div>
    );
  }

  const title = call.title ?? 'Untitled Call';
  const heldOn = call.startedAt ? format(new Date(call.startedAt), 'MM/dd/yyyy, h:mm a') : null;
  const participants = call.participants ?? [];

  const handleGotoCallMessage = (): void => {
    if (!call.channelId || !callConversationId) return;
    void navigate(`/chat/dir/${call.channelId}/${callConversationId}#origin=${callConversationId}`);
  };

  const renderSummaryTab = (): ReactElement => {
    if (call.aiSummary) {
      return (
        <div className='bot-markdown-content-call-summary prose prose-sm max-w-none text-foreground'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{call.aiSummary}</ReactMarkdown>
        </div>
      );
    }
    return <p className='text-sm text-muted-foreground'>No summary available for this call.</p>;
  };

  return (
    <div className='flex h-full overflow-hidden bg-background rounded-2xl'>
      <div className='flex-1 flex flex-col overflow-hidden min-w-0'>
        {/* Header: breadcrumb + Generate PRD */}
        <div className='flex items-center justify-between px-6 py-3 border-b border-border shrink-0'>
          <div className='flex items-center gap-1.5 text-sm min-w-0'>
            <button
              onClick={() => void navigate('..')}
              data-track-category='CallDetail'
              data-track-name='breadcrumb-calls'
              className='text-muted-foreground hover:text-foreground transition-colors shrink-0'
            >
              Calls
            </button>
            <ChevronRight className='size-3.5 text-muted-foreground shrink-0' />
            <Tooltip content={title} delayDuration={500}>
              <span className='text-foreground font-medium truncate max-w-xs'>{title}</span>
            </Tooltip>
          </div>

          <div className='flex items-center gap-2 ml-4 shrink-0'>
            {!isAIOpen && !isMobile && (
              <button
                onClick={openAI}
                data-track-category='CallDetail'
                data-track-name='open-ask-ai'
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors shrink-0'
              >
                <img
                  alt='Ask AI'
                  width='16'
                  height='16'
                  src='/svgs/icons/ai-bot-gradient-star.svg'
                />
                <span className='hidden sm:inline'>Ask AI</span>
              </button>
            )}
            {call.channelId && callConversationId && (
              <button
                onClick={handleGotoCallMessage}
                data-track-category='CallDetail'
                data-track-name='goto-call-message'
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors shrink-0'
              >
                <MessageSquare className='size-4' />
                <span className='hidden sm:inline'>Go to Message</span>
              </button>
            )}
            <button
              onClick={() => setIsPRDModalOpen(true)}
              disabled={isGeneratingPRD}
              data-track-category='CallDetail'
              data-track-name='generate-prd'
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0'
            >
              {isGeneratingPRD ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <ClipboardList className='size-4' />
              )}
              <span className='hidden sm:inline'>Generate PRD</span>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className='flex-1 overflow-y-auto px-8 py-8'>
          <div className='max-w-2xl mx-auto'>
            <h1 className='text-3xl font-bold text-foreground mb-8 leading-tight'>{title}</h1>

            {/* Metadata rows */}
            <div className='flex flex-col gap-4 mb-8'>
              {heldOn && (
                <div className='flex items-center gap-4'>
                  <div className='flex items-center gap-2 w-32 shrink-0 text-muted-foreground'>
                    <Calendar className='size-4' />
                    <span className='text-sm'>Held On</span>
                  </div>
                  <span className='text-sm text-foreground'>{heldOn}</span>
                </div>
              )}

              {participants.length > 0 && (
                <div className='flex items-start gap-4'>
                  <div className='flex items-center gap-2 w-32 shrink-0 text-muted-foreground pt-0.5'>
                    <Users className='size-4' />
                    <span className='text-sm'>Participants</span>
                  </div>
                  <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                    {participants.map(p => {
                      const user = p.isExternal ? null : allUsers.find(u => u.id === p.userId);
                      const name = p.isExternal
                        ? (p.displayName ?? 'Guest')
                        : getUserDisplayName(user);
                      return (
                        <div key={p.id} className='flex items-center gap-1.5'>
                          {!p.isExternal && p.userId && (
                            <Avatar userId={p.userId} size='sm' showActiveStatus={false} />
                          )}
                          <span className='text-sm text-foreground'>{name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasRecording && (
                <div className='flex items-center gap-4'>
                  <div className='flex items-center gap-2 w-32 shrink-0 text-muted-foreground'>
                    <Music className='size-4' />
                    <span className='text-sm'>Audio</span>
                  </div>
                  <div className='flex-1 max-w-md'>
                    <AudioPlayer
                      onLoad={signal =>
                        recordingService.downloadRecordingBlob(call.externalId, signal)
                      }
                      initialDurationSec={durationMs ? durationMs / 1000 : undefined}
                      trackCategory='CallDetail'
                      showToastOnError
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className='border-b border-border mb-6 flex items-start gap-1'>
              {canScrollLeft && (
                <button
                  onClick={() => {
                    tabScrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
                    updateScrollButtons();
                  }}
                  data-track-category='CallDetail'
                  data-track-name='tabs-scroll-left'
                  className='shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-3'
                >
                  <ChevronLeft className='size-3.5' />
                </button>
              )}
              <div
                ref={tabScrollRef}
                onScroll={updateScrollButtons}
                className='flex gap-6 overflow-x-auto no-scrollbar min-w-0'
              >
                {(
                  [
                    { id: 'summary', label: 'Summary', icon: LayoutList },
                    { id: 'transcript', label: 'Transcript', icon: MessageCircle },
                  ] as const
                ).map(({ id, label, icon }) => {
                  const TabIcon = icon;
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      data-track-category='CallDetail'
                      data-track-name={`tab-${id}`}
                      className={cn(
                        'pb-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 shrink-0',
                        activeTab === id
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <TabIcon className='size-4' />
                      {label}
                    </button>
                  );
                })}
                {prdEntries.map(prd => (
                  <button
                    key={prd.id}
                    onClick={() => setActiveTab(prd.id)}
                    data-track-category='CallDetail'
                    data-track-name='tab-prd'
                    className={cn(
                      'pb-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 shrink-0 max-w-[140px]',
                      activeTab === prd.id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {prd.canvasId === null ? (
                      <Loader2 className='size-4 animate-spin shrink-0' />
                    ) : (
                      <FileText className='size-4 shrink-0' />
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
                  className='shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-3'
                >
                  <ChevronRight className='size-3.5' />
                </button>
              )}
            </div>

            {/* Tab content */}
            {activeTab === 'summary' ? (
              renderSummaryTab()
            ) : activeTab === 'transcript' ? (
              <TranscriptTab attachmentId={transcriptAttachmentId} />
            ) : (
              (() => {
                const prd = prdEntries.find(e => e.id === activeTab);
                if (!prd) return null;
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

      <CreateDocumentModal
        isOpen={isPRDModalOpen}
        onClose={() => setIsPRDModalOpen(false)}
        onGenerate={async customPrompt => {
          setIsPRDModalOpen(false);
          await handleGeneratePRD(customPrompt);
        }}
        isLoading={isGeneratingPRD}
        title='Generate PRD'
        description='Choose how you want to generate the Product Requirements Document.'
        standardOptionLabel='Standard PRD'
        standardOptionSubtext='Generate a standard PRD based on the entire call transcript.'
        customOptionLabel='Custom Instructions'
        customOptionSubtext='Provide specific details or focus areas for the PRD.'
        customInputPlaceholder='E.g., Focus on the API authentication flow and error handling...'
      />
    </div>
  );
}
