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
} from 'lucide-react';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor, type BrowserTab } from '../../machines/browserPanelMachine';

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
  isPanel: boolean;
}

function WebviewTab({
  tab,
  isActive,
  webviewRefs,
  onUpdate,
  onUrlUpdate,
  onNewWindow,
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
      onUpdate(tab.id, { title: detail.title });
    };
    const onFavicon = (e: Event) => {
      const detail = (e as CustomEvent<{ favicons: string[] }>).detail;
      const favicon = detail.favicons[0];
      onUpdate(tab.id, { favicon: favicon ? favicon : undefined });
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

    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('page-favicon-updated', onFavicon);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('new-window', onNewWin);

    return () => {
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('page-favicon-updated', onFavicon);
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('new-window', onNewWin);
      delete webviewRefs.current[tab.id];
    };
  }, [tab.id]);

  return (
    <webview
      ref={ref}
      src={initialUrlRef.current}
      // eslint-disable-next-line react/no-unknown-property
      partition='persist:browser-tabs'
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
        minHeight: isPanel ? 200 : 400,
      }}
    />
  );
}

export function BrowserTabsScreen({
  variant = 'fullscreen',
  pendingUrls: externalPendingUrls,
}: BrowserTabsScreenProps = {}): React.ReactElement {
  const tabs = useSelector(browserPanelActor, state => state.context.tabs);
  const activeTabId = useSelector(browserPanelActor, state => state.context.activeTabId);
  const [urlInput, setUrlInput] = useState('');
  const webviewRefs = useRef<Record<string, WebviewTag | null>>({});

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isPanel = variant === 'panel';

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

  // Handle pending URLs from external prop (panel mode)
  useEffect(() => {
    if (!externalPendingUrls || externalPendingUrls.length === 0 || !isElectronApp()) return;

    for (const url of externalPendingUrls) {
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

    if (isPanel) {
      browserPanelActor.send({ type: 'OPEN_URLS', urls: [] });
    }
  }, [externalPendingUrls, isPanel, tabs]);

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

  const handleUpdateTab = (tabId: string, patch: Partial<BrowserTab>) => {
    browserPanelActor.send({ type: 'UPDATE_TAB', tabId, patch });
  };

  const handleUrlUpdate = (tabId: string, url: string) => {
    if (tabId === activeTabId) {
      setUrlInput(url);
    }
  };

  if (!isElectronApp()) {
    return (
      <div className='flex items-center justify-center h-full bg-gray-50'>
        <div className='text-center text-gray-500'>
          <Globe size={48} className='mx-auto mb-4 opacity-50' />
          <p>Browser tabs are only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full bg-white overflow-hidden ${
        isPanel ? 'rounded-xl shadow-sm border border-gray-200' : 'rounded-lg'
      }`}
    >
      {/* Header with close button (panel mode only) */}
      {isPanel && (
        <div className='flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200'>
          <div className='flex items-center gap-2'>
            <Globe size={16} className='text-gray-500' />
            <span className='text-sm font-medium text-gray-700'>Browser</span>
          </div>
          <div className='flex items-center gap-1'>
            {activeTab && (
              <button
                onClick={handleOpenExternal}
                className='p-1.5 rounded-md hover:bg-gray-200 text-gray-500'
                title='Open in system browser'
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              onClick={handleClosePanel}
              className='p-1.5 rounded-md hover:bg-gray-200 text-gray-500'
              title='Close browser panel'
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className='flex items-center bg-gray-100 border-b border-gray-200 px-2 py-1 gap-1'>
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
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
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
                <Globe size={isPanel ? 12 : 14} className='flex-shrink-0 text-gray-400' />
              )}
              <span className='truncate flex-1 text-left'>{tab.title}</span>
              <button
                onClick={e => handleCloseTab(tab.id, e)}
                className='opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300 rounded transition-opacity'
              >
                <X size={isPanel ? 10 : 12} />
              </button>
            </button>
          ))}
        </div>
        <button
          onClick={() => handleCreateTab('https://www.google.com')}
          className='p-1.5 rounded-md hover:bg-gray-200 text-gray-600'
          title='New tab'
        >
          <Plus size={isPanel ? 14 : 16} />
        </button>
      </div>

      {/* URL Bar */}
      <div
        className={`flex items-center bg-gray-50 border-b border-gray-200 ${
          isPanel ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-3 py-2'
        }`}
      >
        <button
          onClick={handleGoBack}
          disabled={!activeTab?.canGoBack}
          className='p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed'
          title='Go back'
        >
          <ArrowLeft size={isPanel ? 14 : 16} />
        </button>
        <button
          onClick={handleGoForward}
          disabled={!activeTab?.canGoForward}
          className='p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed'
          title='Go forward'
        >
          <ArrowRight size={isPanel ? 14 : 16} />
        </button>
        <button
          onClick={handleReload}
          disabled={!activeTabId}
          className='p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed'
          title='Reload'
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
            className={`w-full bg-white border border-gray-300 rounded-md focus:outline-none focus:border-transparent ${
              isPanel
                ? 'px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500'
                : 'px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500'
            }`}
          />
        </form>
      </div>

      {/* Browser Content Area - webview elements render as real DOM */}
      <div className='flex-1 bg-gray-100 relative overflow-hidden'>
        {tabs.map(tab => (
          <WebviewTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            webviewRefs={webviewRefs}
            onUpdate={handleUpdateTab}
            onUrlUpdate={handleUrlUpdate}
            onNewWindow={handleCreateTab}
            isPanel={isPanel}
          />
        ))}

        {tabs.length === 0 && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center text-gray-500 ${
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
              >
                {isPanel ? 'Google' : 'Open Google'}
              </button>
              <button
                onClick={() => handleCreateTab('https://github.com')}
                className={`bg-gray-700 text-white rounded-md hover:bg-gray-800 transition-colors ${
                  isPanel ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'
                }`}
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
