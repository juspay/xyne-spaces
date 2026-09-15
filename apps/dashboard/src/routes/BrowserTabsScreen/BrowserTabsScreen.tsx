import { Fragment, useEffect, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Plus,
  X,
  Globe,
  Loader2,
  ExternalLink,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor, type BrowserTab } from '../../machines/browserPanelMachine';
import { pickWebviewPartition } from '../../utils/browserPanelPartition';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { logger, Event } from '../../utils/logger';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { BrowserSettingsMenu } from '../../components/BrowserPanel/BrowserSettingsMenu';
import { BrowserHintBar } from '../../components/BrowserPanel/BrowserHintBar';
import { useLinkOpenHintDismissed } from '../../hooks/useLinkOpenHintDismissed';
import { usePlatform } from '../../hooks/usePlatform';

// Define WebviewTag interface locally since Electron types may not be available in renderer
interface WebviewTag extends HTMLElement {
  loadURL(url: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  openDevTools(): void;
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean; matchCase?: boolean },
  ): number;
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
  addEventListener(event: string, callback: (e: Event) => void): void;
  removeEventListener(event: string, callback: (e: Event) => void): void;
}

// Find in page result
interface FindInPageResult {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  selectionArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Browser context data for Ask AI
interface BrowserContextData {
  text: string;
  url: string;
  domain: string;
  title: string;
}

// IPC message event from webview
interface WebviewIPCMessageEvent extends Event {
  channel: string;
  args: unknown[];
}

interface BrowserTabsScreenProps {
  variant?: 'fullscreen' | 'panel';
  pendingUrls?: string[];
}

interface WebviewTabProps {
  tab: BrowserTab;
  isActive: boolean;
  webviewRefs: React.MutableRefObject<Record<string, WebviewTag | null>>;
  onUpdate: (tabId: string, patch: Partial<BrowserTab>) => void;
  onUrlUpdate: (tabId: string, url: string) => void;
  onFindResults?: (tabId: string, result: FindInPageResult) => void;
  isPanel: boolean;
  popupsEnabled: boolean;
}

function WebviewTab({
  tab,
  isActive,
  webviewRefs,
  onUpdate,
  onUrlUpdate,
  onFindResults,
  isPanel,
}: WebviewTabProps) {
  const ref = useRef<WebviewTag>(null);
  const initialUrlRef = useRef(tab.url);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    webviewRefs.current[tab.id] = wv;

    // Electron's webview tag puts event payload directly on the event
    // object (not in `.detail`). Accept both shapes for safety.
    const onTitle = (e: Event) => {
      const direct = (e as Event & { title?: string }).title;
      const detailTitle = (e as CustomEvent<{ title?: string }>).detail?.title;
      const title = direct || detailTitle;
      if (title) {
        onUpdate(tab.id, { title });
      }
    };
    const onFavicon = (e: Event) => {
      const direct = (e as Event & { favicons?: string[] }).favicons?.[0];
      const detailFavicon = (e as CustomEvent<{ favicons?: string[] }>).detail?.favicons?.[0];
      const favicon = direct ?? detailFavicon;
      if (favicon !== undefined) {
        onUpdate(tab.id, { favicon: favicon || undefined });
      }
    };
    const onNav = () => {
      onUpdate(tab.id, {
        url: wv.getURL(),
        canGoBack: wv.canGoBack(),
        canGoForward: wv.canGoForward(),
      });
      onUrlUpdate(tab.id, wv.getURL());
    };
    const onStart = () => onUpdate(tab.id, { isLoading: true });
    const onStop = () => onUpdate(tab.id, { isLoading: false });

    // Handle Ask AI requests from webview
    const onAskAI = (e: Event) => {
      const ipcEvent = e as WebviewIPCMessageEvent;
      const channel = ipcEvent.channel;
      const args = ipcEvent.args || [];

      if (channel !== 'ask-ai-request') return;

      const detail = args[0] as BrowserContextData | undefined;
      if (!detail) return;

      // Open XyneAI sidebar with browser context
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'general',
      });

      // Store the browser context in session storage for XyneAI to pick up
      try {
        const contextPill = {
          type: 'browser',
          text: detail.text,
          url: detail.url,
          domain: detail.domain,
          title: detail.title,
          timestamp: Date.now(),
        };
        sessionStorage.setItem('xyne-ai-browser-context', JSON.stringify(contextPill));

        // Dispatch a custom event that XyneAI can listen to
        window.dispatchEvent(
          new CustomEvent('xyne-ai-browser-context-ready', { detail: contextPill }),
        );
      } catch (error) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[BrowserTabsScreen] Failed to store browser context:'),
          error: error,
        });
      }
    };

    // Handle find in page results
    const onFoundInPage = (e: Event) => {
      const detail = (e as CustomEvent<FindInPageResult>).detail;
      onFindResults?.(tab.id, detail);
    };

    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('page-favicon-updated', onFavicon);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('ipc-message', onAskAI);
    wv.addEventListener('found-in-page', onFoundInPage);

    return () => {
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('page-favicon-updated', onFavicon);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('ipc-message', onAskAI);
      wv.removeEventListener('found-in-page', onFoundInPage);
      delete webviewRefs.current[tab.id];
    };
  }, [tab.id]);

  // Partition is chosen from the tab's initial URL: Xyne origins load in the
  // dedicated `persist:xyne-spaces` partition (where auth cookies are synced
  // from the main session) so the panel inherits the user's sign-in.
  // Everything else stays in `persist:browser-tabs` — Xyne cookies never
  // enter that jar, so external sites cannot see them.
  const partitionRef = useRef(pickWebviewPartition(tab.url));

  const webviewProps: Record<string, unknown> = {
    ref,
    src: initialUrlRef.current,
    partition: partitionRef.current,
    // Always allow popups so we can intercept them via new-window event
    // Popup blocking is handled in the new-window event handler
    allowpopups: '',
    // Don't set preload here - let will-attach-webview event in main.ts set it automatically
    // This avoids issues with file paths and ensures the correct absolute path is used
    style: {
      position: 'absolute' as const,
      inset: 0,
      width: '100%',
      height: '100%',
      visibility: isActive ? ('visible' as const) : ('hidden' as const),
      pointerEvents: isActive ? ('auto' as const) : ('none' as const),
      minHeight: isPanel ? 200 : 400,
    },
  };

  return (
    // eslint-disable-next-line react/no-unknown-property
    <webview {...webviewProps} />
  );
}

export function BrowserTabsScreen({
  variant = 'fullscreen',
  pendingUrls: externalPendingUrls,
}: BrowserTabsScreenProps = {}): React.ReactElement {
  const tabs = useSelector(browserPanelActor, state => state.context.tabs);
  const activeTabId = useSelector(browserPanelActor, state => state.context.activeTabId);
  const statePendingUrls = useSelector(browserPanelActor, state => state.context.pendingUrls);
  const browserSettings = useSelector(browserPanelActor, state => state.context.browserSettings);
  const [urlInput, setUrlInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(false);
  const [isFindBarOpen, setIsFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState({ activeMatch: 0, matches: 0 });
  const webviewRefs = useRef<Record<string, WebviewTag | null>>({});
  const findInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const { isMobile, isMac } = usePlatform();
  const { hintDismissed, dismissHint } = useLinkOpenHintDismissed();
  const { track } = useActivityTracking();
  const navigate = useNavigate();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isPanel = variant === 'panel';

  // Use prop if provided (panel mode), otherwise read from state (fullscreen mode)
  const pendingUrls = externalPendingUrls ?? statePendingUrls;

  // Normalize URL (add https:// if missing)
  const normalizeUrl = (url: string): string => {
    let normalized = url.trim();
    if (!normalized) return '';

    // If it looks like a search query (no dots, has spaces)
    if (!normalized.includes('.') || normalized.includes(' ')) {
      return `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
    }

    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }

    return normalized;
  };

  // Handle pending URLs (both panel and fullscreen mode)
  useEffect(() => {
    if (!pendingUrls || pendingUrls.length === 0 || !isElectronApp()) return;

    for (const url of pendingUrls) {
      const existingTab = tabs.find(tab => tab.url === url);
      if (existingTab) {
        browserPanelActor.send({ type: 'SWITCH_TAB', tabId: existingTab.id });
        setUrlInput(existingTab.url);
      } else {
        const id = crypto.randomUUID();
        browserPanelActor.send({
          type: 'ADD_TAB',
          tab: {
            id,
            url,
            title: url,
            canGoBack: false,
            canGoForward: false,
            isLoading: true,
          },
        });
        setUrlInput(url);
      }
    }

    // Clear pendingUrls after processing (both panel and fullscreen)
    browserPanelActor.send({ type: 'OPEN_URLS', urls: [] });
  }, [pendingUrls, isPanel, tabs]);

  // Handle Cmd/Ctrl+T and Cmd/Ctrl+F shortcuts sent from the main process
  // via before-input-event on the webview webContents.  This path works in
  // packaged builds where the webview preload script may not load.
  useEffect(() => {
    if (!isElectronApp()) return;
    const api = window.electronAPI;

    const cleanupNewTab = api?.onBrowserNewTab?.(() => {
      handleCreateNewTab('https://www.google.com');
    });

    const cleanupFindInPage = api?.onBrowserFindInPage?.(() => {
      setIsFindBarOpen(true);
      setTimeout(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }, 50);
    });

    return () => {
      cleanupNewTab?.();
      cleanupFindInPage?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load settings on mount
  useEffect(() => {
    if (isElectronApp() && window.electronAPI?.getBrowserSettings) {
      void window.electronAPI.getBrowserSettings().then(settings => {
        browserPanelActor.send({ type: 'UPDATE_SETTINGS', settings });
      });
    }
  }, []);

  useEffect(() => {
    if (!isFindBarOpen || !activeTabId) return;

    const timeoutId = setTimeout(() => {
      const wv = webviewRefs.current[activeTabId];
      if (!wv) return;

      if (findQuery.trim()) {
        wv.findInPage(findQuery, { findNext: false });
      } else {
        wv.stopFindInPage('clearSelection');
        setFindResults({ activeMatch: 0, matches: 0 });
      }
    }, 300); // Wait 300ms after user stops typing

    return () => clearTimeout(timeoutId);
  }, [findQuery, isFindBarOpen, activeTabId]);

  // Close find bar when switching tabs
  useEffect(() => {
    if (isFindBarOpen) {
      setIsFindBarOpen(false);
      setFindQuery('');
      setFindResults({ activeMatch: 0, matches: 0 });
      const wv = activeTabId ? webviewRefs.current[activeTabId] : null;
      wv?.stopFindInPage('clearSelection');
    }
  }, [activeTabId]);

  // Update URL input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    } else {
      setUrlInput('');
    }
  }, [activeTabId, activeTab?.url]);

  useEffect(() => {
    if (isMobile || !activeTabId || !areControlsVisible) return;
    const rafId = requestAnimationFrame(() => {
      urlInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeTabId, isMobile, areControlsVisible]);

  const handleCreateTab = (url?: string) => {
    const targetUrl = url || normalizeUrl(urlInput);
    if (!targetUrl) return;

    const existingTab = tabs.find(tab => tab.url === targetUrl);
    if (existingTab) {
      browserPanelActor.send({ type: 'SWITCH_TAB', tabId: existingTab.id });
      setUrlInput(existingTab.url);
      return;
    }

    const id = crypto.randomUUID();
    browserPanelActor.send({
      type: 'ADD_TAB',
      tab: {
        id,
        url: targetUrl,
        title: targetUrl,
        canGoBack: false,
        canGoForward: false,
        isLoading: true,
      },
    });
    setUrlInput(targetUrl);
  };

  // Always creates a new tab (no deduplication check) - used for keyboard shortcuts
  const handleCreateNewTab = (url: string = 'https://www.google.com') => {
    const id = crypto.randomUUID();
    browserPanelActor.send({
      type: 'ADD_TAB',
      tab: {
        id,
        url,
        title: url,
        canGoBack: false,
        canGoForward: false,
        isLoading: true,
      },
    });
    setUrlInput(url);
  };

  const handleSwitchTab = (tabId: string) => {
    browserPanelActor.send({ type: 'SWITCH_TAB', tabId });
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    delete webviewRefs.current[tabId];
    const wasLastTab = tabs.length === 1 && tabs[0]?.id === tabId;
    browserPanelActor.send({ type: 'CLOSE_TAB', tabId });
    if (wasLastTab) {
      if (isPanel) {
        browserPanelActor.send({ type: 'CLOSE' });
      } else {
        void navigate(-1);
      }
    }
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    const wv = activeTabId ? webviewRefs.current[activeTabId] : null;
    if (!wv) {
      handleCreateTab();
      return;
    }
    const url = normalizeUrl(urlInput);
    if (url) {
      wv.loadURL(url);
    }
  };

  const handleGoBack = () => {
    const wv = activeTabId ? webviewRefs.current[activeTabId] : null;
    if (wv?.canGoBack()) wv.goBack();
  };

  const handleGoForward = () => {
    const wv = activeTabId ? webviewRefs.current[activeTabId] : null;
    if (wv?.canGoForward()) wv.goForward();
  };

  const handleReload = () => {
    const wv = activeTabId ? webviewRefs.current[activeTabId] : null;
    wv?.reload();
  };

  const handleClosePanel = () => {
    if (isPanel) {
      logger.info(Event.BROWSER_PANEL_CLOSED, {
        url: activeTab?.url,
        tabCount: tabs.length,
      });
      browserPanelActor.send({ type: 'CLOSE' });
    }
  };

  const handleOpenExternal = () => {
    if (activeTab?.url) {
      void (
        window.electronAPI?.openExternal?.(activeTab.url) ?? window.open(activeTab.url, '_blank')
      );
    }
  };

  const handleOpenFullscreen = () => {
    void navigate('/browser');
    if (isPanel) {
      browserPanelActor.send({ type: 'CLOSE' });
    }
  };

  const handleMinimizeToPanel = () => {
    // Navigate back to previous page
    void navigate(-1);
    browserPanelActor.send({ type: 'OPEN' });
    track({
      eventCategory: 'BROWSER',
      eventName: 'MinimizeToDocked',
      eventLabel: 'Minimize from fullscreen to panel',
      contextMetadata: {
        tabs: tabs.map(t => ({ id: t.id, url: t.url })),
      },
    });
  };

  const handleUpdateTab = (tabId: string, patch: Partial<BrowserTab>) => {
    browserPanelActor.send({ type: 'UPDATE_TAB', tabId, patch });
  };

  const handleUrlUpdate = (tabId: string, url: string) => {
    if (tabId === activeTabId) {
      setUrlInput(url);
      track({
        eventCategory: 'BROWSER',
        eventName: 'INTERNAL_NAVIGATION',
        eventLabel: url,
        contextMetadata: {
          tabId,
          url,
        },
      });
    }
  };

  const handleFindNext = () => {
    if (!activeTabId || !findQuery.trim()) return;
    const wv = webviewRefs.current[activeTabId];
    wv?.findInPage(findQuery, { findNext: true, forward: true });
  };

  const handleFindPrevious = () => {
    if (!activeTabId || !findQuery.trim()) return;
    const wv = webviewRefs.current[activeTabId];
    wv?.findInPage(findQuery, { findNext: true, forward: false });
  };

  const handleCloseFindBar = () => {
    setIsFindBarOpen(false);
    setFindQuery('');
    setFindResults({ activeMatch: 0, matches: 0 });
    if (activeTabId) {
      const wv = webviewRefs.current[activeTabId];
      wv?.stopFindInPage('clearSelection');
    }
  };

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCloseFindBar();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        handleFindPrevious();
      } else {
        handleFindNext();
      }
    }
  };

  if (!isElectronApp()) {
    return (
      <div className='flex items-center justify-center h-full bg-background'>
        <div className='text-center text-muted-foreground'>
          <Globe size={48} className='mx-auto mb-4 opacity-50' />
          <p>Browser tabs are only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      {/* Header with close button (panel mode only) — gated by the Eye toggle
          next to the + button so the user can collapse the chrome down to just
          the tab strip. */}
      {areControlsVisible &&
        (isPanel ? (
          <div className='flex items-center justify-between px-3 py-2 bg-muted border-b border-border'>
            <div className='flex items-center gap-2'>
              <Globe size={16} className='text-muted-foreground' />
              <span className='text-sm font-medium text-foreground'>Browser</span>
            </div>
            <div className='flex items-center gap-1'>
              <BrowserSettingsMenu isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} />
              {activeTab && (
                <button
                  onClick={handleOpenExternal}
                  className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
                  title='Open in system browser'
                  data-track-category='BROWSER'
                  data-track-name='OpenInSystemBrowser'
                  data-track-metadata={JSON.stringify({ url: activeTab.url })}
                >
                  <ExternalLink size={14} />
                </button>
              )}
              <button
                onClick={handleClosePanel}
                className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
                title='Close browser panel'
                data-track-category='BROWSER'
                data-track-name='CloseBrowserPanel'
                data-track-metadata={JSON.stringify({ urls: tabs.map(t => t.url) })}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className='flex items-center justify-between px-3 py-2 bg-muted border-b border-border'>
            <div className='flex items-center gap-2'>
              <Globe size={18} className='text-muted-foreground' />
              <span className='text-base font-medium text-foreground'>Browser</span>
            </div>
            <div className='flex items-center gap-1'>
              <BrowserSettingsMenu isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} />
              {activeTab && (
                <button
                  onClick={handleOpenExternal}
                  className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
                  title='Open in system browser'
                  data-track-category='BROWSER'
                  data-track-name='OpenInSystemBrowser'
                  data-track-metadata={JSON.stringify({ url: activeTab.url })}
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        ))}

      {/* Tab Bar */}
      <div className='flex items-center bg-muted border-b border-border px-2 py-0.5 gap-2'>
        <div className='flex-1 flex items-center gap-0.5 overflow-x-auto no-scrollbar'>
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            const prevTab = tabs[index - 1];
            const isPrevActive = !!prevTab && prevTab.id === activeTabId;
            // Browser-style vertical divider between adjacent non-active
            // tabs; suppressed when either side is the active pill.
            const showDivider = index > 0 && !isActive && !isPrevActive;
            return (
              <Fragment key={tab.id}>
                {showDivider && (
                  <div
                    aria-hidden='true'
                    className='w-px h-4 bg-border/70 self-center flex-shrink-0'
                  />
                )}
                <button
                  onClick={() => handleSwitchTab(tab.id)}
                  className={`flex items-center gap-2 rounded-sm group transition-colors ${
                    isPanel
                      ? 'px-3 py-2 text-xs max-w-[200px] min-w-[120px]'
                      : 'px-4 py-2.5 text-sm max-w-[240px] min-w-[160px]'
                  } ${
                    isActive
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:bg-background/50'
                  }`}
                  data-track-category='BROWSER'
                  data-track-name='SwitchTab'
                  data-track-metadata={JSON.stringify({ tabId: tab.id, url: tab.url })}
                >
                  {tab.isLoading ? (
                    <Loader2
                      size={isPanel ? 14 : 16}
                      className='animate-spin flex-shrink-0 text-muted-foreground'
                    />
                  ) : tab.favicon ? (
                    <img
                      src={tab.favicon}
                      alt=''
                      className={isPanel ? 'w-4 h-4 flex-shrink-0' : 'w-5 h-5 flex-shrink-0'}
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Globe
                      size={isPanel ? 14 : 16}
                      className='flex-shrink-0 text-muted-foreground'
                    />
                  )}
                  <span className='truncate flex-1 text-left font-medium'>{tab.title}</span>
                  <button
                    onClick={e => handleCloseTab(tab.id, e)}
                    className='p-0.5 hover:bg-muted-foreground/20 rounded transition-colors flex-shrink-0'
                    data-track-category='BROWSER'
                    data-track-name='CloseTab'
                    data-track-metadata={JSON.stringify({ tabId: tab.id, url: tab.url })}
                  >
                    <X size={isPanel ? 12 : 14} />
                  </button>
                </button>
              </Fragment>
            );
          })}
        </div>
        <button
          onClick={() => handleCreateTab('https://www.google.com')}
          className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
          title='New tab'
          data-track-category='BROWSER'
          data-track-name='CreateNewTab'
          data-track-metadata={JSON.stringify({ url: 'https://www.google.com' })}
        >
          <Plus size={isPanel ? 14 : 16} />
        </button>
        <button
          onClick={isPanel ? handleOpenFullscreen : handleMinimizeToPanel}
          className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
          title={isPanel ? 'Open in fullscreen browser' : 'Minimize to docked panel'}
          data-track-category='BROWSER'
          data-track-name={isPanel ? 'OpenFullscreenBrowser' : 'MinimizeToDocked'}
          data-track-metadata={JSON.stringify({ urls: tabs.map(t => t.url) })}
        >
          {isPanel ? <Maximize2 size={14} /> : <Minimize2 size={isPanel ? 14 : 16} />}
        </button>
        <button
          onClick={() => setAreControlsVisible(v => !v)}
          className={`p-1.5 rounded-md hover:bg-border ${
            areControlsVisible ? 'text-foreground' : 'text-muted-foreground'
          }`}
          title={areControlsVisible ? 'Hide browser controls' : 'Show browser controls'}
          aria-pressed={areControlsVisible}
          data-track-category='BROWSER'
          data-track-name='ToggleBrowserControls'
        >
          {areControlsVisible ? (
            <EyeOff size={isPanel ? 14 : 16} />
          ) : (
            <Eye size={isPanel ? 14 : 16} />
          )}
        </button>
        {/* Keep the close button reachable when the header is collapsed so
            the user can still dismiss the browser panel. In the expanded
            state the header already has its own close button. */}
        {isPanel && !areControlsVisible && (
          <button
            onClick={handleClosePanel}
            className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
            title='Close browser panel'
            data-track-category='BROWSER'
            data-track-name='CloseBrowserPanel'
            data-track-metadata={JSON.stringify({ urls: tabs.map(t => t.url) })}
          >
            <X size={isPanel ? 14 : 16} />
          </button>
        )}
      </div>

      {/* URL Bar */}
      {areControlsVisible && (
        <div
          className={`flex items-center bg-muted border-b border-border ${
            isPanel ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-3 py-2'
          }`}
        >
          <button
            onClick={handleGoBack}
            disabled={!activeTab?.canGoBack}
            className='p-1 rounded-md hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed'
            title='Go back'
            data-track-category='BROWSER'
            data-track-name='GoBack'
            data-track-metadata={JSON.stringify({ url: activeTab?.url })}
          >
            <ArrowLeft size={isPanel ? 14 : 16} />
          </button>
          <button
            onClick={handleGoForward}
            disabled={!activeTab?.canGoForward}
            className='p-1 rounded-md hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed'
            title='Go forward'
            data-track-category='BROWSER'
            data-track-name='GoForward'
            data-track-metadata={JSON.stringify({ url: activeTab?.url })}
          >
            <ArrowRight size={isPanel ? 14 : 16} />
          </button>
          <button
            onClick={handleReload}
            disabled={!activeTabId}
            className='p-1 rounded-md hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed'
            title='Reload'
            data-track-category='BROWSER'
            data-track-name='ReloadPage'
            data-track-metadata={JSON.stringify({ url: activeTab?.url })}
          >
            {activeTab?.isLoading ? (
              <Loader2 size={isPanel ? 14 : 16} className='animate-spin' />
            ) : (
              <RotateCw size={isPanel ? 14 : 16} />
            )}
          </button>

          <form onSubmit={handleNavigate} className='flex-1'>
            <input
              ref={urlInputRef}
              type='text'
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder='Enter a URL or search...'
              className={`w-full bg-background border border-input rounded-md focus:outline-none focus:border-transparent ${
                isPanel
                  ? 'px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500'
                  : 'px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500'
              }`}
              data-track-category='BROWSER'
              data-track-name='EditUrlBar'
            />
          </form>
        </div>
      )}

      <AnimatePresence>
        {isElectronApp() && !hintDismissed && (
          <BrowserHintBar
            key='browser-hint-bar'
            isMac={isMac}
            onOpenPreferences={() => {
              dismissHint();
              window.dispatchEvent(
                new CustomEvent('xyne-open-preferences', { detail: { section: 'messaging' } }),
              );
            }}
            onDismiss={dismissHint}
          />
        )}
      </AnimatePresence>

      {/* Browser Content Area - webview elements render as real DOM */}
      <div className='flex-1 bg-muted relative overflow-hidden'>
        {tabs.map(tab => (
          <WebviewTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            webviewRefs={webviewRefs}
            onUpdate={handleUpdateTab}
            onUrlUpdate={handleUrlUpdate}
            onFindResults={(tabId, result) => {
              if (tabId === activeTabId) {
                setFindResults({
                  activeMatch: result.activeMatchOrdinal,
                  matches: result.matches,
                });
              }
            }}
            isPanel={isPanel}
            popupsEnabled={browserSettings.popups}
          />
        ))}

        {/* Find in Page Bar */}
        {isFindBarOpen && (
          <div className='absolute top-2 right-2 bg-background border border-border rounded-lg shadow-lg p-2 flex items-center gap-2 z-50 min-w-[300px]'>
            <input
              ref={findInputRef}
              type='text'
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              onKeyDown={handleFindKeyDown}
              placeholder='Find in page...'
              className='flex-1 bg-muted px-3 py-1.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
              data-track-category='BROWSER'
              data-track-name='FIND_IN_PAGE_INPUT'
            />
            {findResults.matches > 0 && (
              <span className='text-xs text-muted-foreground whitespace-nowrap'>
                {findResults.activeMatch}/{findResults.matches}
              </span>
            )}
            <button
              onClick={handleFindPrevious}
              disabled={findResults.matches === 0}
              className='p-1.5 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed'
              title='Previous match (Shift+Enter)'
              data-track-category='BROWSER'
              data-track-name='FIND_PREVIOUS_MATCH'
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={handleFindNext}
              disabled={findResults.matches === 0}
              className='p-1.5 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed'
              title='Next match (Enter)'
              data-track-category='BROWSER'
              data-track-name='FIND_NEXT_MATCH'
            >
              <ChevronDown size={16} />
            </button>
            <button
              onClick={handleCloseFindBar}
              className='p-1.5 rounded-md hover:bg-muted text-muted-foreground'
              title='Close (Esc)'
              data-track-category='BROWSER'
              data-track-name='CLOSE_FIND_BAR'
            >
              <X size={16} />
            </button>
          </div>
        )}

        {tabs.length === 0 && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center text-muted-foreground ${
              isPanel ? 'p-4' : ''
            }`}
          >
            <Globe size={isPanel ? 40 : 64} className='mb-4 opacity-30' />
            {!isPanel && <h2 className='text-xl font-medium mb-2'>Welcome to Browser</h2>}
            <p className={`text-center mb-4 ${isPanel ? 'text-xs' : 'text-sm mb-6'}`}>
              {isPanel
                ? 'Enter a URL above or click + to open a new tab'
                : 'Enter a URL above or click the + button to open a new tab'}
            </p>
            <div className='flex gap-2'>
              <button
                onClick={() => handleCreateTab('https://www.google.com')}
                className={`bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors ${
                  isPanel ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'
                }`}
                data-track-category='BROWSER'
                data-track-name='OpenGoogle'
              >
                {isPanel ? 'Google' : 'Open Google'}
              </button>
              <button
                onClick={() => handleCreateTab('https://github.com')}
                className={`bg-gray-700 text-white rounded-md hover:bg-gray-800 transition-colors ${
                  isPanel ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'
                }`}
                data-track-category='BROWSER'
                data-track-name='OpenGitHub'
              >
                {isPanel ? 'GitHub' : 'Open GitHub'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
