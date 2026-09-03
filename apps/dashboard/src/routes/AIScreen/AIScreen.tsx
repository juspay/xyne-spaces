import { type ReactElement, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Upload, PanelRightOpen } from 'lucide-react';
import { AIShell } from '../../components/AIScreen/AIShell';
import { ArtifactAppPane } from '../../components/AIScreen/ReactArtifact/ArtifactAppPane';
import { AppCreationModeProvider } from '../../components/AIScreen/ReactArtifact/appCreationModeContext';
import { useAppModeCollapseSidebar } from '../../hooks/useAppModeCollapseSidebar';
import { useAppCreationMode } from '../../components/AIScreen/ReactArtifact/useAppCreationMode';
import { AIEmptyState } from '../../components/AIScreen/AIEmptyState';
import {
  AIComposer,
  type AIComposerHandle,
  type AIComposerAttachment,
} from '../../components/AIScreen/AIComposer';
import type { ComposerContext } from '../../components/AIScreen/composerContext';
import { AIChatThread, type AIChatThreadHandle } from '../../components/AIScreen/AIChatThread';
import { CitationDocsProvider } from '../../components/AIScreen/citationDocs';
import { ChatWithCitationDocs } from '../../components/AIScreen/CitationDocsPanel';
import { xyneAIStreamManager } from '../../services/XyneAI/XyneAIStreamManager';
import { useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { AI_ACTIVE_SESSION_KEY, AI_SHOW_CHAT_VIEW_KEY } from './aiSessionStorage';

const AIScreen = (): ReactElement => {
  const { workspaceId, sessionId: routeSessionId } = useParams<{
    workspaceId?: string;
    sessionId?: string;
  }>();
  const location = useLocation();
  /** '' for the landing page — `chat/new` is the literal, not a session id. */
  const sessionFromUrl = routeSessionId && routeSessionId !== 'new' ? routeSessionId : '';

  // The URL is the source of truth for the thread. `/ai/chat/new` means a NEW
  // chat — full stop. The old sessionStorage restore is gone: it predates
  // threads having URLs, and once they did it turned "new" into "whatever you
  // had open last" (observed: navigating to chat/new landed on the most recent
  // thread). Reload-keeps-your-chat now comes from the thread being in the URL,
  // and the Library/daily-brief handoff navigates to the thread URL directly.
  const [activeSessionId, setActiveSessionId] = useState(() => sessionFromUrl);
  const [showChatView, setShowChatView] = useState(() =>
    sessionFromUrl ? true : sessionStorage.getItem(AI_SHOW_CHAT_VIEW_KEY) === '1',
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
  const { selectedAgentSlug } = useSelectedAgent();
  const isV2 = true;
  const effectiveAgentSlug = selectedAgentSlug;
  const { invalidateSessions: invalidateV2Sessions } = useV2SessionInvalidator();

  useEffect(() => {
    showChatViewRef.current = showChatView;
  }, [showChatView]);

  // ── Thread ↔ URL, two-way ────────────────────────────────────────────────
  // Each direction fires only when ITS OWN source actually changed, tracked in
  // a ref. Dep-array firing is not enough: effects run in the commit where the
  // OTHER side is still stale. Concretely, clicking New Chat sets
  // activeSessionId='' while the URL param still holds the old thread — an
  // unguarded URL→state effect then "corrects" the state right back to the old
  // thread, which is exactly the bounce this replaced.

  // state → URL. `location.search` is carried so ?mode=create-app survives.
  const lastPushedSession = useRef(activeSessionId);
  useEffect(() => {
    if (lastPushedSession.current === activeSessionId) return;
    lastPushedSession.current = activeSessionId;
    const target = activeSessionId || 'new';
    if ((routeSessionId ?? 'new') === target) return;
    if (!workspaceId) return;
    void navigate(`/${workspaceId}/ai/chat/${target}${location.search}`, { replace: true });
  }, [activeSessionId, routeSessionId, workspaceId, location.search, navigate]);

  // URL → state, for Back/Forward and pasted links.
  const lastSeenUrlSession = useRef(sessionFromUrl);
  useEffect(() => {
    if (lastSeenUrlSession.current === sessionFromUrl) return;
    lastSeenUrlSession.current = sessionFromUrl;
    if (sessionFromUrl === activeSessionId) return;
    // Keep the other direction's ref in step, so this externally-driven change
    // is not then re-announced as a state change.
    lastPushedSession.current = sessionFromUrl;
    setActiveSessionId(sessionFromUrl);
    setShowChatView(Boolean(sessionFromUrl));
    setInitialQuery('');
    setInitialAttachments(undefined);
    setChatKey(prev => prev + 1);
  }, [sessionFromUrl, activeSessionId]);

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

  // The thread has fired the landing query — drop it so it can never be
  // auto-submitted twice. Without this the thread's `useRef` guard resets on any
  // remount and the same query is sent again as a NEW conversation.
  // `initialExtras` is deliberately kept: it seeds the chat composer's context
  // selections for the whole conversation, not just the first turn.
  const handleInitialQueryConsumed = useCallback((): void => {
    setInitialQuery('');
    setInitialAttachments(undefined);
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
      invalidateV2Sessions(effectiveAgentSlug);
    },
    [effectiveAgentSlug, invalidateV2Sessions],
  );

  const handleAccount = useCallback((): void => {
    void navigate('./settings');
  }, [navigate]);

  // App Creation mode. The thread reports which app it is building; the mode
  // hook decides whether the split view is on and which version the pane shows.
  const [appId, setAppId] = useState<string | null>(null);
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
  const appMode = useAppCreationMode(appId, activeSessionId || null, latestVersionId);
  const { appModeCollapseSidebar } = useAppModeCollapseSidebar();
  // Sidebar plumbing: the panel lives in AIShell; the toggle button lives in
  // the chat header. The ref carries the action up-and-over, the state carries
  // the panel's real collapsed-ness back for the button's icon.
  const sidebarToggleRef = useRef<(() => void) | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const handleToggleSidebar = useCallback(() => sidebarToggleRef.current?.(), []);
  // One collapse per APP, and only for an app generated live with the
  // preference on. A counter event, not state: state would re-assert itself on
  // every thread switch and undo a sidebar the user deliberately opened.
  const [collapseSignal, setCollapseSignal] = useState(0);
  const collapsedForApps = useRef(new Set<string>());

  // The thread reports its app, but only while it is MOUNTED. On the landing
  // page (showChatView false) and in the gap before a newly-selected thread has
  // loaded, nothing reports — so a stale appId from the previous chat would
  // keep the pane open over a thread that has no app. Clear it here instead of
  // relying on the thread to say "none".
  useEffect(() => {
    if (!showChatView) {
      setAppId(null);
      setLatestVersionId(null);
    }
  }, [showChatView]);
  // Clear on a real thread SWITCH only.
  //
  // A draft acquiring its server id ('' → 'chat-…') is not a switch — it is the
  // same thread being named, and it lands at roughly the same moment the first
  // artifact is reported. Clearing there wiped the appId the thread had just
  // surfaced, and because `displayMessages` does not change again after the
  // stream ends, the scan never re-ran: a newly created app never entered App
  // Creation mode, while an existing thread (id present from the start) did.
  const prevSession = useRef(activeSessionId);
  useEffect(() => {
    const from = prevSession.current;
    prevSession.current = activeSessionId;
    if (!from) return; // draft → named, or first mount: keep what we have
    if (from === activeSessionId) return;
    setAppId(null);
    setLatestVersionId(null);
  }, [activeSessionId]);
  const handleAppChange = useCallback(
    (id: string | null, versionId: string | null, generatedLive: boolean) => {
      setAppId(id);
      setLatestVersionId(versionId);
      if (generatedLive && id && appModeCollapseSidebar && !collapsedForApps.current.has(id)) {
        collapsedForApps.current.add(id);
        setCollapseSignal(n => n + 1);
      }
    },
    [appModeCollapseSidebar],
  );
  // Entry from a card. Sets the app and opens the mode together, so the pane
  // never depends on the message-list scan having reported the app first —
  // that chain (scan → onAppChange → state → hook effect) was the part that
  // made entry a coin flip. The scan still runs, for clearing on thread switch
  // and for the freshness signal, but it is no longer on the entry path.
  const { open: openAppMode } = appMode;
  const enterForApp = useCallback(
    (id: string, versionId: string | null) => {
      setAppId(id);
      if (versionId) setLatestVersionId(versionId);
      openAppMode();
    },
    [openAppMode],
  );
  // Routed through the thread's handle rather than a composer ref of its own:
  // the thread owns submit (draft recovery, branch parenting), so a fix request
  // takes exactly the path a typed message does.
  const submitPrompt = useCallback(
    (text: string): boolean => chatThreadRef.current?.submitPrompt(text) ?? false,
    [],
  );
  // A fresh object here re-renders every context consumer — that is every
  // artifact card in the transcript — on each AIScreen render.
  const appModeSignal = useMemo(
    () => ({
      active: appMode.active,
      appId: appMode.appId,
      viewingVersionId: appMode.viewingVersionId,
      headVersionId: appMode.headVersionId,
      restores: appMode.restores,
      viewVersion: appMode.viewVersion,
      restoreVersion: appMode.restoreVersion,
      restoring: appMode.restoring,
      enterForApp,
      submitPrompt,
    }),
    [
      appMode.active,
      appMode.appId,
      appMode.viewingVersionId,
      appMode.headVersionId,
      appMode.restores,
      appMode.viewVersion,
      appMode.restoreVersion,
      appMode.restoring,
      enterForApp,
      submitPrompt,
    ],
  );
  // Likewise a fresh element remounts the pane's subtree each render.
  const appPane = useMemo(() => <ArtifactAppPane mode={appMode} />, [appMode]);

  return (
    <CitationDocsProvider>
      <AppCreationModeProvider value={appModeSignal}>
        <AIShell
          activeSessionId={activeSessionId}
          onCreateChat={handleCreateChat}
          onSelectSession={handleSelectSession}
          onAccount={handleAccount}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
          mainRef={dropZoneRef}
          collapseSignal={collapseSignal}
          onSidebarCollapsedChange={setSidebarCollapsed}
          sidebarToggleRef={sidebarToggleRef}
          {...(appMode.active ? { rightPanel: appPane } : {})}
        >
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
          {appMode.hasApp && !appMode.active && showChatView && (
            <button
              type='button'
              onClick={appMode.open}
              className='absolute right-4 top-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground'
              title='Reopen the app panel'
              data-track-category='AskAI'
              data-track-name='ArtifactAppPaneReopen'
            >
              <PanelRightOpen className='h-3.5 w-3.5' aria-hidden='true' />
              Open app
            </button>
          )}
          {showChatView ? (
            <ChatWithCitationDocs>
              <AIChatThread
                ref={chatThreadRef}
                key={chatKey}
                sessionId={activeSessionId || undefined}
                initialQuery={initialQuery}
                initialAttachments={initialAttachments}
                initialExtras={initialExtras}
                onSetMobileSidebarOpen={setMobileSidebarOpen}
                onConversationChange={handleConversationChange}
                onAppChange={handleAppChange}
                onToggleSidebar={handleToggleSidebar}
                sidebarCollapsed={sidebarCollapsed}
                onAgentChange={handleAgentChange}
                onContextChange={handleContextChange}
                onInitialQueryConsumed={handleInitialQueryConsumed}
              />
            </ChatWithCitationDocs>
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
                    showAgentSelector={isV2}
                    onContextChange={handleContextChange}
                    hideDisclaimer
                  />
                </div>
              </div>
            </main>
          )}
        </AIShell>
      </AppCreationModeProvider>
    </CitationDocsProvider>
  );
};

export default AIScreen;
