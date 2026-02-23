import { useCallback, useEffect, useRef, useState } from 'react';
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
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { useHasOverlay } from '../../machines/stateMachine';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

interface BrowserTabsScreenProps {
  variant?: 'fullscreen' | 'panel';
  pendingUrls?: string[];
}

export function BrowserTabsScreen({
  variant = 'fullscreen',
  pendingUrls: externalPendingUrls,
}: BrowserTabsScreenProps = {}): React.ReactElement {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isPanel = variant === 'panel';
  const hasOverlay = useHasOverlay();

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
    if (
      !externalPendingUrls ||
      externalPendingUrls.length === 0 ||
      !isInitialized ||
      !isElectronApp()
    )
      return;

    const api = window.electronAPI?.browserTabs;
    if (!api) return;

    const openPendingUrls = async () => {
      for (const url of externalPendingUrls) {
        const existingTab = tabs.find(tab => tab.url === url);

        if (existingTab) {
          await api.switch(existingTab.id);
          setActiveTabId(existingTab.id);
        } else {
          const result = await api.create(url);
          if (result.success && result.tab) {
            setTabs(prev => [...prev, result.tab!]);
            setActiveTabId(result.tab.id);
            setUrlInput(result.tab.url);
          }
        }
      }

      if (isPanel) {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [] });
      }
    };

    void openPendingUrls();
  }, [externalPendingUrls, isInitialized, isPanel]);

  // Update bounds when component mounts or resizes
  const updateBounds = useCallback(() => {
    if (!isElectronApp() || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    window.electronAPI?.browserTabs?.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  // Initialize and set up event listeners
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI?.browserTabs;
    if (!api) return;

    // Fetch existing tabs
    const initTabs = async () => {
      const result = await api.getAll();
      if (result.success) {
        setTabs(result.tabs);
        setActiveTabId(result.activeTabId);
      }
      setIsInitialized(true);

      // Show the browser tabs view
      api.show();
    };

    void initTabs();

    // Set up event listeners
    const cleanups: Array<() => void> = [];

    cleanups.push(
      api.onTitleUpdated(data => {
        setTabs(prev =>
          prev.map(tab => (tab.id === data.tabId ? { ...tab, title: data.title } : tab)),
        );
      }),
    );

    cleanups.push(
      api.onFaviconUpdated(data => {
        setTabs(prev =>
          prev.map(tab => (tab.id === data.tabId ? { ...tab, favicon: data.favicon } : tab)),
        );
      }),
    );

    cleanups.push(
      api.onUrlUpdated(data => {
        setTabs(prev =>
          prev.map(tab =>
            tab.id === data.tabId
              ? {
                  ...tab,
                  url: data.url,
                  canGoBack: data.canGoBack,
                  canGoForward: data.canGoForward,
                }
              : tab,
          ),
        );
        // Update URL input if this is the active tab
        if (data.tabId === activeTabId) {
          setUrlInput(data.url);
        }
      }),
    );

    cleanups.push(
      api.onLoadingChanged(data => {
        setTabs(prev =>
          prev.map(tab => (tab.id === data.tabId ? { ...tab, isLoading: data.isLoading } : tab)),
        );
      }),
    );

    cleanups.push(
      api.onTabSwitched(data => {
        setActiveTabId(data.tabId);
      }),
    );

    cleanups.push(
      api.onTabClosed(data => {
        setTabs(prev => prev.filter(tab => tab.id !== data.tabId));
      }),
    );

    return () => {
      // Hide browser tabs when leaving this screen
      api.hide();
      cleanups.forEach(cleanup => cleanup());
    };
  }, [activeTabId]);

  // Update bounds on mount and resize
  useEffect(() => {
    if (!isInitialized) return;

    updateBounds();
    window.addEventListener('resize', updateBounds);

    // Use ResizeObserver for more accurate size tracking
    const resizeObserver = new ResizeObserver(updateBounds);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateBounds);
      resizeObserver.disconnect();
    };
  }, [isInitialized, updateBounds]);

  // Screenshot + hide approach: when overlays open, capture a screenshot of the
  // WebContentsView, hide the native view, and show the screenshot as an <img>.
  // The Dialog's own backdrop-blur-sm + bg-black/50 then applies naturally.
  useEffect(() => {
    if (!isElectronApp() || !activeTabId) return;

    const api = window.electronAPI?.browserTabs;
    if (!api?.captureTab || !api?.setTabVisible) return;

    if (hasOverlay) {
      // Capture screenshot, then hide native view
      void api.captureTab(activeTabId).then(result => {
        if (result.success && result.dataUrl) {
          setScreenshotDataUrl(result.dataUrl);
        }
        // Hide native view so Dialog's backdrop renders on top of the screenshot
        api.setTabVisible(activeTabId, false);
      });
    } else {
      // Show native view and clear screenshot
      api.setTabVisible(activeTabId, true);
      setScreenshotDataUrl(null);
    }
  }, [hasOverlay, activeTabId]);

  // Update URL input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    } else {
      setUrlInput('');
    }
  }, [activeTabId, activeTab]);

  const handleCreateTab = async (url?: string) => {
    const api = window.electronAPI?.browserTabs;
    if (!api) return;

    const targetUrl = url || normalizeUrl(urlInput);
    if (!targetUrl) return;

    const existingTab = tabs.find(tab => tab.url === targetUrl);

    if (existingTab) {
      await api.switch(existingTab.id);
      setActiveTabId(existingTab.id);
      setUrlInput(existingTab.url);
    } else {
      const result = await api.create(targetUrl);
      if (result.success && result.tab) {
        setTabs(prev => [...prev, result.tab!]);
        setActiveTabId(result.tab.id);
        setUrlInput(result.tab.url);
      }
    }
  };

  // Switch to a tab
  const handleSwitchTab = async (tabId: string) => {
    const api = window.electronAPI?.browserTabs;
    if (!api) return;

    await api.switch(tabId);
    setActiveTabId(tabId);
  };

  // Close a tab
  const handleCloseTab = async (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const api = window.electronAPI?.browserTabs;
    if (!api) return;

    await api.close(tabId);
  };

  // Navigate to URL
  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = window.electronAPI?.browserTabs;
    if (!api || !activeTabId) {
      // No active tab, create a new one
      await handleCreateTab();
      return;
    }

    const url = normalizeUrl(urlInput);
    if (url) {
      await api.navigate(activeTabId, url);
    }
  };

  // Navigation controls
  const handleGoBack = async () => {
    if (!activeTabId) return;
    await window.electronAPI?.browserTabs?.goBack(activeTabId);
  };

  const handleGoForward = async () => {
    if (!activeTabId) return;
    await window.electronAPI?.browserTabs?.goForward(activeTabId);
  };

  const handleReload = async () => {
    if (!activeTabId) return;
    await window.electronAPI?.browserTabs?.reload(activeTabId);
  };

  // Close panel (panel mode only)
  const handleClosePanel = () => {
    if (isPanel) {
      browserPanelActor.send({ type: 'CLOSE' });
    }
  };

  // Open in system browser (panel mode only)
  const handleOpenExternal = () => {
    if (activeTab?.url) {
      window.electronAPI?.openExternal(activeTab.url);
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

  if (!window.electronAPI?.browserTabs) {
    return (
      <div className='flex items-center justify-center h-full bg-gray-50'>
        <div className='text-center text-gray-500'>
          <Globe size={48} className='mx-auto mb-4 opacity-50' />
          <p>Please update to the latest desktop app version to use Xyne Browser.</p>
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
              onClick={() => void handleSwitchTab(tab.id)}
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
                onClick={e => void handleCloseTab(tab.id, e)}
                className='opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300 rounded transition-opacity'
              >
                <X size={isPanel ? 10 : 12} />
              </button>
            </button>
          ))}
        </div>
        <button
          onClick={() => void handleCreateTab('https://www.google.com')}
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
          onClick={() => void handleGoBack()}
          disabled={!activeTab?.canGoBack}
          className='p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed'
          title='Go back'
        >
          <ArrowLeft size={isPanel ? 14 : 16} />
        </button>
        <button
          onClick={() => void handleGoForward()}
          disabled={!activeTab?.canGoForward}
          className='p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed'
          title='Go forward'
        >
          <ArrowRight size={isPanel ? 14 : 16} />
        </button>
        <button
          onClick={() => void handleReload()}
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

        <form onSubmit={e => void handleNavigate(e)} className='flex-1'>
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

      {/* Browser Content Area - WebContentsView renders over this */}
      <div
        ref={containerRef}
        className='flex-1 bg-gray-100 relative'
        style={{ minHeight: isPanel ? 200 : 400 }}
      >
        {/* Screenshot placeholder shown when dialog/overlay is open */}
        {screenshotDataUrl && (
          <img
            src={screenshotDataUrl}
            alt=''
            className='absolute inset-0 w-full h-full object-cover'
            style={{ pointerEvents: 'none' }}
          />
        )}

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
                onClick={() => void handleCreateTab('https://www.google.com')}
                className={`bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors ${
                  isPanel ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'
                }`}
              >
                {isPanel ? 'Google' : 'Open Google'}
              </button>
              <button
                onClick={() => void handleCreateTab('https://github.com')}
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
