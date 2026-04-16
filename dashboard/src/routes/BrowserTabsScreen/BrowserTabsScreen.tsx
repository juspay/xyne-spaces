import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor, type BrowserTab } from '../../machines/browserPanelMachine';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { BrowserSettingsMenu } from '../../components/BrowserPanel/BrowserSettingsMenu';

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
  onNewWindow: (url: string) => void;
  onFindResults?: (tabId: string, result: FindInPageResult) => void;
  onShortcut?: (shortcut: string) => void;
  isPanel: boolean;
  popupsEnabled: boolean;
}

function WebviewTab({
  tab,
  isActive,
  webviewRefs,
  onUpdate,
  onUrlUpdate,
  onNewWindow,
  onFindResults,
  onShortcut,
  isPanel,
}: WebviewTabProps) {
  const ref = useRef<WebviewTag>(null);
  const initialUrlRef = useRef(tab.url);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    webviewRefs.current[tab.id] = wv;

    const onTitle = (e: Event) => {
      const detail = (e as CustomEvent<{ title: string }>).detail;
      if (detail?.title) {
        onUpdate(tab.id, { title: detail.title });
      }
    };
    const onFavicon = (e: Event) => {
      const detail = (e as CustomEvent<{ favicons: string[] }>).detail;
      const favicon = detail?.favicons?.[0];
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
    const onNewWin = (e: Event) => {
      const detail = (e as CustomEvent<{ url: string }>).detail;
      onNewWindow(detail.url);
    };

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
        console.error('[BrowserTabsScreen] Failed to store browser context:', error);
      }
    };

    // Handle find in page results
    const onFoundInPage = (e: Event) => {
      const detail = (e as CustomEvent<FindInPageResult>).detail;
      onFindResults?.(tab.id, detail);
    };

    // Handle shortcuts from webview (Cmd+T, Cmd+F, etc.)
    const onShortcutMessage = (e: Event) => {
      const ipcEvent = e as WebviewIPCMessageEvent;
      const channel = ipcEvent.channel;
      const args = ipcEvent.args || [];

      if (channel !== 'webview-shortcut') return;

      const shortcut = args[0] as string;
      if (shortcut) {
        onShortcut?.(shortcut);
      }
    };

    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('page-favicon-updated', onFavicon);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('new-window', onNewWin);
    wv.addEventListener('ipc-message', onAskAI);
    wv.addEventListener('ipc-message', onShortcutMessage);
    wv.addEventListener('found-in-page', onFoundInPage);

    return () => {
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('page-favicon-updated', onFavicon);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('new-window', onNewWin);
      wv.removeEventListener('ipc-message', onAskAI);
      wv.removeEventListener('ipc-message', onShortcutMessage);
      wv.removeEventListener('found-in-page', onFoundInPage);
      delete webviewRefs.current[tab.id];
    };
  }, [tab.id]);

  const webviewProps: Record<string, unknown> = {
    ref,
    src: initialUrlRef.current,
    partition: 'persist:browser-tabs',
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
  const [isFindBarOpen, setIsFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState({ activeMatch: 0, matches: 0 });
  const webviewRefs = useRef<Record<string, WebviewTag | null>>({});
  const findInputRef = useRef<HTMLInputElement>(null);
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
    browserPanelActor.send({ type: 'CLOSE_TAB', tabId });
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
      {/* Header with close button (panel mode only) */}
      {isPanel ? (
        <div className='flex items-center justify-between px-3 py-2 bg-muted border-b border-border'>
          <div className='flex items-center gap-2'>
            <Globe size={16} className='text-muted-foreground' />
            <span className='text-sm font-medium text-foreground'>Browser</span>
          </div>
          <div className='flex items-center gap-1'>
            <BrowserSettingsMenu isOpen={isSettingsOpen} setIsOpen={setIsSettingsOpen} />
            <button
              onClick={handleOpenFullscreen}
              className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
              title='Open in fullscreen browser'
              data-track-category='BROWSER'
              data-track-name='OpenFullscreenBrowser'
              data-track-metadata={JSON.stringify({ urls: tabs.map(t => t.url) })}
            >
              <Maximize2 size={14} />
            </button>
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
            <button
              onClick={handleMinimizeToPanel}
              className='p-1.5 rounded-md hover:bg-border text-muted-foreground'
              title='Minimize to docked panel'
              data-track-category='BROWSER'
              data-track-name='MinimizeToDocked'
              data-track-metadata={JSON.stringify({ urls: tabs.map(t => t.url) })}
            >
              <Minimize2 size={16} />
            </button>
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
      )}

      {/* Tab Bar */}
      <div className='flex items-center bg-muted border-b border-border px-2 py-1 gap-1'>
        <div className='flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar'>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleSwitchTab(tab.id)}
              className={`flex items-center gap-2 rounded-md group transition-colors ${
                isPanel
                  ? 'px-2 py-1 text-xs max-w-[160px] min-w-[80px]'
                  : 'px-3 py-1.5 text-sm max-w-[200px] min-w-[120px]'
              } ${
                tab.id === activeTabId
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:bg-border'
              }`}
              data-track-category='BROWSER'
              data-track-name='SwitchTab'
              data-track-metadata={JSON.stringify({ tabId: tab.id, url: tab.url })}
            >
              {tab.isLoading ? (
                <Loader2 size={isPanel ? 12 : 14} className='animate-spin flex-shrink-0' />
              ) : tab.favicon ? (
                <img
                  src={tab.favicon}
                  alt=''
                  className={isPanel ? 'w-3 h-3 flex-shrink-0' : 'w-4 h-4 flex-shrink-0'}
                  onError={e => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Globe size={isPanel ? 12 : 14} className='flex-shrink-0 text-muted-foreground' />
              )}
              <span className='truncate flex-1 text-left'>{tab.title}</span>
              <button
                onClick={e => handleCloseTab(tab.id, e)}
                className='opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted-foreground/50 rounded transition-opacity'
                data-track-category='BROWSER'
                data-track-name='CloseTab'
                data-track-metadata={JSON.stringify({ tabId: tab.id, url: tab.url })}
              >
                <X size={isPanel ? 10 : 12} />
              </button>
            </button>
          ))}
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
      </div>

      {/* URL Bar */}
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
            onNewWindow={handleCreateTab}
            onFindResults={(tabId, result) => {
              if (tabId === activeTabId) {
                setFindResults({
                  activeMatch: result.activeMatchOrdinal,
                  matches: result.matches,
                });
              }
            }}
            onShortcut={shortcut => {
              if (shortcut === 'new-tab') {
                handleCreateNewTab('https://www.google.com');
              } else if (shortcut === 'find-in-page') {
                setIsFindBarOpen(true);
                setTimeout(() => {
                  findInputRef.current?.focus();
                  findInputRef.current?.select();
                }, 50);
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
