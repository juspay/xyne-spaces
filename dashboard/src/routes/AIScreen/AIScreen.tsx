import { type ReactElement, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../utils/classNames';
import { AISidebar } from '../../components/AIScreen/AISidebar';
import { AIEmptyState } from '../../components/AIScreen/AIEmptyState';
import { AIComposer } from '../../components/AIScreen/AIComposer';
import { AIChatThread } from '../../components/AIScreen/AIChatThread';
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
  const [chatKey, setChatKey] = useState(0);
  const navigate = useNavigate();
  const { invalidateSessions } = useV2SessionInvalidator();

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

  const handleCreateChat = useCallback((): void => {
    setActiveSessionId('');
    setInitialQuery('');
    setChatKey(prev => prev + 1);
    setShowChatView(false); // Return to landing page
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string): void => {
      if (sessionId === activeSessionId) return;
      setActiveSessionId(sessionId);
      setInitialQuery('');
      setChatKey(prev => prev + 1);
      setShowChatView(true);
    },
    [activeSessionId],
  );

  const handleComposerSubmit = useCallback((text: string): void => {
    setInitialQuery(text);
    setActiveSessionId('');
    setChatKey(prev => prev + 1);
    setShowChatView(true);
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
      <div className='relative flex h-full min-w-0 flex-1 flex-col'>
        {showChatView ? (
          <AIChatThread
            key={chatKey}
            sessionId={activeSessionId || undefined}
            initialQuery={initialQuery}
            onSetMobileSidebarOpen={setMobileSidebarOpen}
            onConversationChange={handleConversationChange}
          />
        ) : (
          /* Landing page – centred greeting + composer */
          <main className='flex h-full flex-1 items-center justify-center px-6 py-8'>
            <div className='flex w-full max-w-2xl flex-col'>
              <AIEmptyState />
              <div className='mt-6'>
                <AIComposer autoFocus onSubmit={handleComposerSubmit} hideDisclaimer />
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default AIScreen;
