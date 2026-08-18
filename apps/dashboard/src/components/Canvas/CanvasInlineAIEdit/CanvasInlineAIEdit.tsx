import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bug, Check, FileText, Loader2, Send, TextQuote, X } from 'lucide-react';

import { ActivityBlock } from '../../Chat/XyneAISidebar/components/ActivityBlock';
import { AskAIDebugPanel } from '../../Chat/XyneAISidebar/components/AskAIDebugPanel';
import { PendingActionBlock } from '../../Chat/XyneAISidebar/components/PendingActionBlock';
import type {
  DebugEventRecord,
  Message,
  SelectionContext,
} from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { respondToPendingAction } from '../../../services/XyneAI/XyneAIPendingActionService';
import { useXyneAIStream } from '../../../hooks/useXyneAIStream';
import { cn } from '../../../utils/classNames';

interface CanvasInlineAIEditProps {
  canvasId: string;
  canvasTitle?: string | undefined;
  channelId?: string | undefined;
  selectedText: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

const createInlineAIStreamKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `canvas-inline-ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const INLINE_ASK_AI_POPOVER_WIDTH = 560;

const InlineContextChip = ({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}): React.JSX.Element => (
  <div className='inline-flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 text-xs font-medium text-muted-foreground'>
    <span className='shrink-0 text-muted-foreground'>{icon}</span>
    <span className='truncate'>{label}</span>
  </div>
);

interface PopoverPosition {
  left: number;
  top: number;
}

const clampPopoverPosition = (position: PopoverPosition): PopoverPosition => {
  if (typeof window === 'undefined') return position;

  const maxLeft = Math.max(window.innerWidth - INLINE_ASK_AI_POPOVER_WIDTH - 16, 16);
  const maxTop = Math.max(window.innerHeight - 120, 16);

  return {
    left: Math.min(Math.max(position.left, 16), maxLeft),
    top: Math.min(Math.max(position.top, 16), maxTop),
  };
};

const getInitialPopoverPosition = (rect: DOMRect): PopoverPosition => {
  if (typeof window === 'undefined') return { left: rect.left, top: rect.bottom + 12 };

  const top = Math.min(rect.bottom + 12, window.innerHeight - 260);
  const preferredLeft = rect.width === 0 ? rect.left : rect.left;
  const left = Math.min(
    Math.max(preferredLeft, 16),
    Math.max(window.innerWidth - INLINE_ASK_AI_POPOVER_WIDTH - 16, 16),
  );
  return { left, top };
};

const getPopoverStyle = (position: PopoverPosition): React.CSSProperties => {
  const maxHeight =
    typeof window === 'undefined' ? 420 : Math.max(280, window.innerHeight - position.top - 24);
  return {
    position: 'fixed',
    top: position.top,
    left: position.left,
    width: INLINE_ASK_AI_POPOVER_WIDTH,
    maxHeight,
    zIndex: 90,
  };
};

export function CanvasInlineAIEdit({
  canvasId,
  canvasTitle,
  channelId,
  selectedText,
  anchorRect,
  onClose,
}: CanvasInlineAIEditProps): React.JSX.Element {
  const streamKeyRef = useRef(createInlineAIStreamKey());
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDebugger, setShowDebugger] = useState(false);
  const [debugEvents, setDebugEvents] = useState<DebugEventRecord[]>([]);
  const [debugArtifactsReadyVersion, setDebugArtifactsReadyVersion] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>(() =>
    getInitialPopoverPosition(anchorRect),
  );
  const dragStateRef = useRef<{
    pointerId: number;
    offsetLeft: number;
    offsetTop: number;
  } | null>(null);

  const selectionContexts = useMemo<SelectionContext[]>(
    () => [
      {
        canvasId,
        selectedText,
        preview: selectedText.length > 80 ? `${selectedText.slice(0, 80)}...` : selectedText,
        ...(canvasTitle && { canvasTitle }),
      },
    ],
    [canvasId, canvasTitle, selectedText],
  );

  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: [],
    conversationId,
    streamSessionKey: streamKeyRef.current,
    canvasId,
    setMessages,
    setConversationId,
    setDebugEvents,
    setDebugArtifactsReadyVersion,
    isV2: true,
    suppressCompletionToast: true,
    channelId,
    canvasIds: [canvasId],
  });

  const botMessage = [...messages].reverse().find(message => message.type === 'bot');
  const userMessage = [...messages].reverse().find(message => message.type === 'user');
  const responseText = botMessage?.streamingContent || botMessage?.content || '';
  const isStreaming = messages.some(message => message.isStreaming);
  const canShowDebugger = messages.length > 0 || debugEvents.length > 0 || Boolean(conversationId);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSubmitting || isStreaming) return;
    setIsSubmitting(true);
    try {
      await submitQuery(nextPrompt, [], selectionContexts, nextPrompt);
      setPrompt('');
    } finally {
      setIsSubmitting(false);
    }
  }, [isStreaming, isSubmitting, prompt, selectionContexts, submitQuery]);

  const handleClose = useCallback((): void => {
    abortCurrentRequest();
    onClose();
  }, [abortCurrentRequest, onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void handleSubmit();
  };

  const handleDragStart = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        offsetLeft: event.clientX - popoverPosition.left,
        offsetTop: event.clientY - popoverPosition.top,
      };
    },
    [popoverPosition.left, popoverPosition.top],
  );

  const handleDragMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    setPopoverPosition(
      clampPopoverPosition({
        left: event.clientX - dragState.offsetLeft,
        top: event.clientY - dragState.offsetTop,
      }),
    );
  }, []);

  const handleDragEnd = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      data-canvas-inline-ai-edit='true'
      className='flex flex-col overflow-hidden rounded-[18px] border border-input bg-background shadow-[0_18px_60px_rgba(15,23,42,0.16)]'
      style={getPopoverStyle(popoverPosition)}
    >
      <div className='thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        <div className='mb-3 flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div
              className='flex cursor-move touch-none select-none items-center gap-2 text-sm font-semibold text-foreground'
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <img alt='AI' width='14' height='14' src='/svgs/icons/ai-bot-gradient-star.svg' />
              Ask AI
            </div>
            <blockquote className='mt-3 line-clamp-3 border-l-2 border-blue-400 pl-3 text-sm text-muted-foreground'>
              {selectedText}
            </blockquote>
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <InlineContextChip
                icon={<FileText className='size-3.5' />}
                label={canvasTitle || 'Current canvas'}
              />
              <InlineContextChip icon={<TextQuote className='size-3.5' />} label='Selected text' />
            </div>
          </div>
          <button
            type='button'
            className='inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground'
            onClick={handleClose}
            aria-label='Close Ask AI'
            data-track-category='CANVAS'
            data-track-name='Inline_Ask_AI_Close'
            data-track-metadata={JSON.stringify({ canvasId })}
          >
            <X className='size-4' />
          </button>
        </div>
        {messages.length > 0 && (
          <div className='space-y-3 border-t border-border pt-3'>
            <div className='flex items-start justify-between gap-3'>
              {userMessage?.content ? (
                <div className='min-w-0 rounded-xl bg-muted/45 px-3 py-2 text-sm text-foreground'>
                  {userMessage.content}
                </div>
              ) : (
                <span />
              )}

              {canShowDebugger && (
                <button
                  type='button'
                  className='inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground'
                  onClick={() => setShowDebugger(open => !open)}
                  aria-label='Toggle debug panel'
                  aria-pressed={showDebugger}
                  data-track-category='CANVAS'
                  data-track-name='Inline_Ask_AI_Debug_Toggle'
                  data-track-metadata={JSON.stringify({ canvasId })}
                >
                  <Bug className='size-3.5' />
                </button>
              )}
            </div>

            {botMessage && (
              <ActivityBlock
                reasoning={botMessage.reasoning}
                toolInvocations={botMessage.toolInvocations}
                streaming={botMessage.isStreaming}
                messageAborted={!!botMessage.isAborted}
              />
            )}

            {responseText ? (
              <div className='xyne-ai-markdown text-sm leading-6 text-foreground'>
                <ReactMarkdown>{responseText}</ReactMarkdown>
              </div>
            ) : null}

            {!botMessage?.isStreaming && botMessage?.followUpSuggestions?.length ? (
              <div className='flex flex-wrap gap-2' data-testid='inline-ask-ai-follow-ups'>
                {botMessage.followUpSuggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    type='button'
                    className='rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent'
                    onClick={() => setPrompt(suggestion)}
                    data-track-category='CANVAS'
                    data-track-name='Inline_Ask_AI_Follow_Up_Suggestion'
                    data-track-metadata={JSON.stringify({ canvasId, suggestion })}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            {!botMessage && (
              <ActivityBlock
                reasoning={undefined}
                toolInvocations={undefined}
                streaming
                messageAborted={false}
              />
            )}

            {botMessage?.pendingActions && botMessage.pendingActions.length > 0 && (
              <PendingActionBlock
                actions={botMessage.pendingActions}
                onApprove={async (action, index) => {
                  await respondToPendingAction(botMessage, action, index, true);
                }}
                onDecline={async (action, index) => {
                  await respondToPendingAction(botMessage, action, index, false);
                }}
              />
            )}

            {botMessage?.pendingActions?.some(action => action.resolution === 'approved') && (
              <div className='flex items-center gap-2 text-xs text-emerald-600'>
                <Check className='size-3.5' />
                Approved
              </div>
            )}
          </div>
        )}

        {showDebugger && (
          <div className='mt-4 h-[420px] overflow-hidden rounded-xl border border-border'>
            <AskAIDebugPanel
              open={showDebugger}
              inline
              width={560}
              conversationId={conversationId || streamKeyRef.current}
              agentSlug='ask-ai'
              liveEvents={debugEvents}
              running={isStreaming}
              artifactsReadyVersion={debugArtifactsReadyVersion}
              selectedTurnIndex={null}
              selectedTurnLive={isStreaming}
              selectedSessionId={botMessage?.debugSessionId ?? null}
              focusToolCallId={null}
              onClose={() => setShowDebugger(false)}
            />
          </div>
        )}
      </div>

      <div className='flex items-center gap-3 border-t border-border bg-background px-5 py-3'>
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask AI to edit this selection...'
          rows={1}
          className='max-h-24 min-h-[38px] flex-1 resize-none rounded-[20px] border border-input bg-background px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring'
          data-track-category='CANVAS'
          data-track-name='Inline_Ask_AI_Prompt'
          data-track-metadata={JSON.stringify({ canvasId })}
        />
        <button
          type='button'
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground',
          )}
          onClick={() => void handleSubmit()}
          disabled={!prompt.trim() || isSubmitting || isStreaming}
          aria-label='Send Ask AI prompt'
          data-track-category='CANVAS'
          data-track-name='Inline_Ask_AI_Submit'
          data-track-metadata={JSON.stringify({ canvasId })}
        >
          {isSubmitting || isStreaming ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <Send className='size-4' />
          )}
        </button>
      </div>
    </div>
  );
}
