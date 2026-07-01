import { type ReactElement, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { AISidebar } from '../../components/AIScreen/AISidebar';
import { AIEmptyState } from '../../components/AIScreen/AIEmptyState';
import {
  AIComposer,
  type AIComposerHandle,
  type AIComposerAttachment,
} from '../../components/AIScreen/AIComposer';
import type { ComposerContext } from '../../components/AIScreen/composerContext';
import { AIChatThread, type AIChatThreadHandle } from '../../components/AIScreen/AIChatThread';
import { xyneAIStreamManager } from '../../services/XyneAI/XyneAIStreamManager';
import { useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';

const AI_ACTIVE_SESSION_KEY = 'ai-active-session-id';
const AI_SHOW_CHAT_VIEW_KEY = 'ai-show-chat-view';

const AIScreen = (): ReactElement => {
  const [activeSessionId, setActiveSessionId] = useState(
    () => sessionStorage.getItem(AI_ACTIVE_SESSION_KEY) ?? '',
  );
  const [showChatView, setShowChatView] = useState(
    () => sessionStorage.getItem(AI_SHOW_CHAT_VIEW_KEY) === '1',
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string>('');
  const [initialAttachments, setInitialAttachments] = useState<AIComposerAttachment[] | undefined>(
    undefined,
  );
  const [initialExtras, setInitialExtras] = useState<ComposerContext | undefined>(undefined);
  const [chatKey, setChatKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const landingComposerRef = useRef<AIComposerHandle | null>(null);
  const chatThreadRef = useRef<AIChatThreadHandle | null>(null);
  const dragCounterRef = useRef(0);
  const showChatViewRef = useRef(showChatView);
  // Latest composer context reported by whichever composer is mounted. Lets us
  // carry the user's selections (channels, KB, web search, …) into a recent
  // chat instead of clearing them — matching XyneAISidebar.
  const lastContextRef = useRef<ComposerContext | undefined>(undefined);
  const navigate = useNavigate();
  const { invalidateSessions } = useV2SessionInvalidator();

  useEffect(() => {
    showChatViewRef.current = showChatView;
  }, [showChatView]);

  useEffect(() => {
    if (activeSessionId) {
      sessionStorage.setItem(AI_ACTIVE_SESSION_KEY, activeSessionId);
    } else {
      sessionStorage.removeItem(AI_ACTIVE_SESSION_KEY);
    }
  }, [activeSessionId]);

  useEffect(() => {
    sessionStorage.setItem(AI_SHOW_CHAT_VIEW_KEY, showChatView ? '1' : '0');
  }, [showChatView]);

  // Prevent completion toast notifications when on the /ai page
  useEffect(() => {
    xyneAIStreamManager.setOnAIPage(true);
    return () => {
      xyneAIStreamManager.setOnAIPage(false);
    };
  }, []);

  // Drag and drop on the main content area — routes dropped files into
  // whichever composer is currently visible (landing or chat thread).
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;

    const hasFiles = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types?.includes('Files'));

    const handleDragEnter = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    };
    const handleDragOver = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleDragLeave = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    const handleDrop = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const fileArray = Array.from(files).filter(f => f instanceof File);
      if (fileArray.length === 0) return;
      // AIChatThread has its own drop zone — only handle landing-view drops here.
      if (!showChatViewRef.current) {
        landingComposerRef.current?.addFiles(fileArray);
      } else {
        chatThreadRef.current?.addFiles(fileArray);
      }
    };

    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, []);

  const handleCreateChat = useCallback((): void => {
    setActiveSessionId('');
    setInitialQuery('');
    setInitialAttachments(undefined);
    setInitialExtras(undefined);
    setChatKey(prev => prev + 1);
    setShowChatView(false); // Return to landing page
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string): void => {
      if (sessionId === activeSessionId) return;
      setActiveSessionId(sessionId);
      setInitialQuery('');
      setInitialAttachments(undefined);
      // Preserve the composer's current selections when opening a recent chat
      // (mirrors XyneAISidebar, where composer state lives in the parent and is
      // not reset on conversation load).
      setInitialExtras(lastContextRef.current);
      setChatKey(prev => prev + 1);
      setShowChatView(true);
    },
    [activeSessionId],
  );

  const handleContextChange = useCallback((context: ComposerContext): void => {
    lastContextRef.current = context;
  }, []);

  const handleComposerSubmit = useCallback(
    (text: string, attachments?: AIComposerAttachment[], context?: ComposerContext): void => {
      setInitialQuery(text);
      setInitialAttachments(attachments);
      setInitialExtras(context);
      setActiveSessionId('');
      setChatKey(prev => prev + 1);
      setShowChatView(true);
    },
    [],
  );

  // Switching agents opens a fresh conversation scoped to that agent but
  // PRESERVES the user's composer selections (channels, KB, web search, …),
  // matching the XyneAISidebar behaviour. Seeding initialExtras carries the
  // selections into the remounted chat composer; the landing composer keeps its
  // own state (it isn't remounted).
  const handleAgentChange = useCallback((_slug: string | null, context: ComposerContext): void => {
    setInitialQuery('');
    setInitialAttachments(undefined);
    setInitialExtras(context);
    setActiveSessionId('');
    setChatKey(prev => prev + 1);
  }, []);

  const handleConversationChange = useCallback(
    (sessionId: string): void => {
      setActiveSessionId(sessionId);
      // A new chat just acquired its server sessionId — refresh the recents
      // list so this conversation shows up immediately, without needing a
      // page reload or a navigate-away-and-back.
      invalidateSessions();
    },
    [invalidateSessions],
  );

  const handleAccount = useCallback((): void => {
    void navigate('./settings');
  }, [navigate]);

  return (
    <div className={cn('ai-page-bg flex h-full w-full')}>
      {/* ─── Left sidebar (xyne-search style) ─── */}
      <AISidebar
        activeSessionId={activeSessionId}
        onCreateChat={handleCreateChat}
        onSelectSession={handleSelectSession}
        onAccount={handleAccount}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
      />

      {/* ─── Main content ─── */}
      <div ref={dropZoneRef} className='relative flex h-full min-w-0 flex-1 flex-col'>
        {isDragging && !showChatView && (
          <div className='pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/95 backdrop-blur-sm'>
            <div className='flex flex-col items-center gap-3'>
              <div className='rounded-full bg-primary/10 p-4'>
                <Upload className='h-8 w-8 text-primary' />
              </div>
              <div className='text-center'>
                <p className='text-lg font-medium text-foreground'>Drop files to attach</p>
                <p className='text-sm text-muted-foreground'>
                  Images, PDF, text, office documents, or data files
                </p>
              </div>
            </div>
          </div>
        )}
        {showChatView ? (
          <AIChatThread
            ref={chatThreadRef}
            key={chatKey}
            sessionId={activeSessionId || undefined}
            initialQuery={initialQuery}
            initialAttachments={initialAttachments}
            initialExtras={initialExtras}
            onSetMobileSidebarOpen={setMobileSidebarOpen}
            onConversationChange={handleConversationChange}
            onAgentChange={handleAgentChange}
            onContextChange={handleContextChange}
          />
        ) : (
          /* Landing page – centred greeting + composer */
          <main className='flex h-full flex-1 items-center justify-center px-6 py-8'>
            <div className='flex w-full max-w-2xl flex-col'>
              <AIEmptyState />
              <div className='mt-6'>
                <AIComposer
                  ref={landingComposerRef}
                  autoFocus
                  onSubmit={handleComposerSubmit}
                  onAgentChange={handleAgentChange}
                  onContextChange={handleContextChange}
                  hideDisclaimer
                />
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default AIScreen;
