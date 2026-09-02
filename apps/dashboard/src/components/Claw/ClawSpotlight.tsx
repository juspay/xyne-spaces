import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, History, Square, SquarePen, X } from 'lucide-react';
import { cn } from '../../utils/classNames';
import type { ConversationHistory as ConversationHistoryType } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { AgentSelector } from '../Chat/XyneAISidebar/components/AgentSelector';
import { ConversationHistory } from '../Chat/XyneAISidebar/components/ConversationHistory';
import { useClawConversation } from './ClawConversationContext';
import { useClawOverlayBridge } from './useClawOverlayBridge';
import { MessageList } from './ClawChat/MessageList';
import { MAX_TEXTAREA_HEIGHT_PX } from './ClawChat/clawChat.constants';
import { contentGroupVariants } from './claw.motion';

const DRAG_THRESHOLD_PX = 4;

interface ClawSpotlightProps {
  maxHeight: number;
  onDesiredHeight: (height: number) => void;
  onRequestClose: () => void;
}

export function ClawSpotlight({
  maxHeight,
  onDesiredHeight,
  onRequestClose,
}: ClawSpotlightProps): ReactElement {
  const {
    messages,
    isStreaming,
    conversationId,
    selectedAgentSlug,
    agents,
    sessions,
    sessionsLoading,
    loadingSessionId,
    submitQuery,
    abortCurrentRequest,
    selectAgent,
    newChat,
    loadConversation,
    deleteConversation,
    refetchSessions,
  } = useClawConversation();

  const bridge = useClawOverlayBridge();
  const [value, setValue] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const hasThread = messages.length > 0 || showHistory;

  useEffect(() => {
    const rafId = requestAnimationFrame(() => textareaRef.current?.focus());
    return (): void => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [value]);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.height;
      if (typeof next === 'number') setComposerHeight(Math.ceil(next));
    });
    observer.observe(el);
    setComposerHeight(Math.ceil(el.getBoundingClientRect().height));
    return (): void => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasThread) {
      onDesiredHeight(maxHeight);
      return;
    }
    if (composerHeight > 0) onDesiredHeight(composerHeight);
  }, [hasThread, composerHeight, maxHeight, onDesiredHeight]);

  useEffect(() => {
    if (showHistory) refetchSessions();
  }, [showHistory, refetchSessions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (showHistory) {
        setShowHistory(false);
        return;
      }
      onRequestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [showHistory, onRequestClose]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent): void => {
      const origin = dragOriginRef.current;
      if (!origin || draggingRef.current) return;
      const moved = Math.abs(e.screenX - origin.x) + Math.abs(e.screenY - origin.y);
      if (moved <= DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      bridge.dragStart();
    };
    const handlePointerUp = (): void => {
      dragOriginRef.current = null;
      if (!draggingRef.current) return;
      draggingRef.current = false;
      bridge.dragEnd();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return (): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [bridge]);

  const handleDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, textarea, input, a, [role="combobox"], [role="dialog"]')) return;
    dragOriginRef.current = { x: e.screenX, y: e.screenY };
    draggingRef.current = false;
  }, []);

  const handleSubmit = useCallback((): void => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    setShowHistory(false);
    submitQuery(trimmed);
    setValue('');
  }, [value, isStreaming, submitQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleRetry = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find(m => m.type === 'user');
    if (!lastUserMessage) return;
    submitQuery(lastUserMessage.content);
  }, [messages, submitQuery]);

  const handleLoadConversation = useCallback(
    async (conversation: ConversationHistoryType): Promise<void> => {
      if (await loadConversation(conversation)) setShowHistory(false);
    },
    [loadConversation],
  );

  const handleNewChat = useCallback(() => {
    setShowHistory(false);
    setValue('');
    newChat();
    textareaRef.current?.focus();
  }, [newChat]);

  const streamingSessionIds = useMemo(
    () => (isStreaming && conversationId ? [conversationId] : []),
    [isStreaming, conversationId],
  );

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <AnimatePresence initial={false}>
        {hasThread && (
          <motion.div
            key='claw-spotlight-thread'
            variants={contentGroupVariants}
            initial='hidden'
            animate='show'
            exit='exit'
            className='flex min-h-0 flex-1 flex-col border-b border-border'
          >
            {showHistory ? (
              <ConversationHistory
                conversations={sessions}
                conversationId={conversationId}
                loadingSessionId={loadingSessionId}
                streamingSessionIds={streamingSessionIds}
                isLoading={sessionsLoading && sessions.length === 0}
                onBack={() => setShowHistory(false)}
                onClose={() => setShowHistory(false)}
                onLoadConversation={conversation => {
                  void handleLoadConversation(conversation);
                }}
                onDeleteConversation={deleteConversation}
                selectedAgentSlug={selectedAgentSlug}
                agents={agents}
                onSelectAgent={selectAgent}
                agentSelectorDisabled={isStreaming}
              />
            ) : (
              <MessageList messages={messages} onRetry={handleRetry} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={composerRef}
        className='shrink-0'
        onPointerDown={handleDragPointerDown}
        data-claw-drag-region
      >
        <div className='flex items-start gap-2 px-4 pb-2 pt-3.5'>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Ask Claw anything...'
            rows={1}
            data-track-category='CLAW_SPOTLIGHT'
            data-track-name='COMPOSER_INPUT'
            className={cn(
              'max-h-32 flex-1 resize-none bg-transparent text-[15px] leading-6',
              'text-foreground outline-none placeholder:text-muted-foreground',
            )}
          />
          {isStreaming ? (
            <button
              type='button'
              onClick={abortCurrentRequest}
              aria-label='Stop generating'
              data-track-category='CLAW_SPOTLIGHT'
              data-track-name='STOP_GENERATION'
              className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent'
            >
              <Square className='size-3 fill-current' />
            </button>
          ) : (
            <button
              type='button'
              onClick={handleSubmit}
              disabled={!canSend}
              aria-label='Send message'
              data-track-category='CLAW_SPOTLIGHT'
              data-track-name='SEND_MESSAGE'
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                canSend
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'cursor-not-allowed bg-muted text-muted-foreground',
              )}
            >
              <ArrowUp className='size-4' />
            </button>
          )}
        </div>
        <div className='flex items-center justify-between gap-2 px-3 pb-2.5'>
          <AgentSelector
            selectedAgentSlug={selectedAgentSlug}
            agents={agents}
            onSelect={selectAgent}
            disabled={isStreaming}
            compact
          />
          <div className='flex shrink-0 items-center gap-1'>
            <button
              type='button'
              onClick={handleNewChat}
              aria-label='New chat'
              title='New chat'
              data-track-category='CLAW_SPOTLIGHT'
              data-track-name='NEW_CHAT'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <SquarePen className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => setShowHistory(prev => !prev)}
              aria-label='Conversation history'
              title='Conversation history'
              data-track-category='CLAW_SPOTLIGHT'
              data-track-name='TOGGLE_HISTORY'
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
                showHistory
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <History className='size-4' />
            </button>
            <button
              type='button'
              onClick={onRequestClose}
              aria-label='Close Claw'
              title='Close'
              data-track-category='CLAW_SPOTLIGHT'
              data-track-name='CLOSE_SPOTLIGHT'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <X className='size-4' />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
