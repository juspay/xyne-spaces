import React, { useState, useRef } from 'react';
import { Globe, X, RefreshCw, ExternalLink, Plus } from 'lucide-react';
import { isElectronApp } from '../../../utils/electronApp';

// Extend HTMLElement to include Electron webview properties
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  reload?: () => void;
  getURL?: () => string;
}

interface PreviewTab {
  id: string;
  url: string;
  title: string;
}

interface WorkflowPreviewPanelProps {
  className?: string;
}

// Check if running in Electron
const isElectron = isElectronApp();

/**
 * WorkflowPreviewPanel - Self-contained embedded webview for workflow previews
 * This component manages its own local tabs, completely independent of the global webview sidebar
 * In Electron: Uses <webview> tag for full browser capabilities
 * In Browser: Opens URLs in external tabs (due to CORS/iframe restrictions)
 */
export const WorkflowPreviewPanel: React.FC<WorkflowPreviewPanelProps> = ({ className = '' }) => {
  // Local state - NOT connected to the global webviewActor
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const webviewRefs = useRef<Map<string, ElectronWebviewElement>>(new Map());
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Extract domain from URL for display
  const getDomainFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  };

  // Open a new URL - in browser, opens externally; in Electron, opens in local tab
  const openUrl = (url: string, title?: string): void => {
    if (!isElectron) {
      // In browser, open in new tab externally
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    // In Electron, create a local tab
    const newTab: PreviewTab = {
      id: `preview-tab-${Date.now()}`,
      url,
      title: title || getDomainFromUrl(url),
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  // Close a tab
  const closeTab = (tabId: string, e?: React.MouseEvent): void => {
    e?.stopPropagation();
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1]?.id || null);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
    webviewRefs.current.delete(tabId);
    iframeRefs.current.delete(tabId);
  };

  // Refresh the active tab
  const refreshActiveTab = (): void => {
    if (!activeTabId) return;

    if (isElectron) {
      const webview = webviewRefs.current.get(activeTabId);
      if (webview?.reload) {
        setIsLoading(true);
        webview.reload();
        setTimeout(() => setIsLoading(false), 1000);
      }
    } else {
      const iframe = iframeRefs.current.get(activeTabId);
      if (iframe) {
        setIsLoading(true);
        // Force reload by setting src to itself
        const currentSrc = iframe.src;
        iframe.src = '';
        iframe.src = currentSrc;
        setTimeout(() => setIsLoading(false), 1000);
      }
    }
  };

  // Open URL in external browser
  const openExternal = (): void => {
    if (activeTab?.url) {
      window.open(activeTab.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Empty state - no tabs open (or browser mode)
  if (tabs.length === 0) {
    return (
      <div className={`h-full flex flex-col bg-background ${className}`}>
        <div className='flex-1 relative bg-muted'>
          <div className='absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-background'>
            <div className='w-14 h-14 rounded-xl flex items-center justify-center mb-4 shadow-lg'>
              <Globe size={24} className='text-black' />
            </div>
            <h3 className='text-base font-semibold text-foreground mb-1.5'>Preview Panel</h3>
            <p className='text-sm text-muted-foreground max-w-xs leading-relaxed'>
              {isElectron
                ? 'This panel shows live previews of your application. URLs will be loaded here when the agent runs preview commands.'
                : 'Preview URLs will open in a new browser tab. For embedded previews, use the Electron desktop app.'}
            </p>

            {/* Demo buttons */}
            <div className='mt-6 flex flex-col gap-2'>
              <button
                onClick={() => openUrl('https://www.google.com', 'Google')}
                className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm font-medium'
                data-track-category='Workflows'
                data-track-name='OpenGoogleDemo'
              >
                <ExternalLink size={14} />
                {isElectron ? 'Open Google.com (Demo)' : 'Open Google.com in New Tab'}
              </button>
              <button
                onClick={() => openUrl('https://example.com', 'Example')}
                className='flex items-center gap-2 px-3 py-1.5 bg-muted text-foreground rounded-lg hover:bg-border transition-colors text-xs'
                data-track-category='Workflows'
                data-track-name='OpenExampleDemo'
              >
                <Globe size={12} />
                Open Example.com
              </button>
            </div>

            {!isElectron && (
              <p className='text-xs text-muted-foreground mt-4 max-w-xs'>
                💡 Tip: Use the Electron desktop app for embedded preview support
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render tabs and webview content locally
  return (
    <div className={`h-full flex flex-col bg-background ${className}`}>
      {/* Tab Bar */}
      <div className='flex-shrink-0 bg-muted border-b border-border'>
        <div className='flex items-center h-9'>
          {/* Tabs */}
          <div
            className='flex-1 flex items-center overflow-x-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`group relative flex items-center border-r border-border text-sm whitespace-nowrap transition-colors ${
                  activeTabId === tab.id
                    ? 'bg-background text-foreground'
                    : 'bg-muted hover:bg-muted text-muted-foreground'
                }`}
              >
                <button
                  onClick={() => setActiveTabId(tab.id)}
                  className='flex items-center gap-2 px-3 py-2 flex-1 text-left min-w-0'
                  data-track-category='Workflows'
                  data-track-name='SelectPreviewTab'
                  data-track-metadata={JSON.stringify({ tabId: tab.id, tabTitle: tab.title })}
                >
                  <Globe size={12} className='flex-shrink-0 text-muted-foreground' />
                  <span className='truncate max-w-[120px] text-xs font-medium'>
                    {tab.title || getDomainFromUrl(tab.url)}
                  </span>
                </button>
                <button
                  onClick={e => closeTab(tab.id, e)}
                  className='px-2 py-2 opacity-0 group-hover:opacity-100 hover:bg-border transition-all'
                  title='Close tab'
                  data-track-category='Workflows'
                  data-track-name='ClosePreviewTab'
                  data-track-metadata={JSON.stringify({ tabId: tab.id })}
                >
                  <X size={12} className='text-muted-foreground' />
                </button>
                {/* Active indicator */}
                {activeTabId === tab.id && (
                  <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-action-primary' />
                )}
              </div>
            ))}

            {/* Add Tab Button */}
            <button
              onClick={() => openUrl('about:blank', 'New Tab')}
              className='flex items-center justify-center p-2 text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors'
              title='New tab'
              data-track-category='Workflows'
              data-track-name='AddNewPreviewTab'
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Tab Actions */}
          <div className='flex-shrink-0 flex items-center gap-0.5 px-2 border-l border-border'>
            <button
              onClick={refreshActiveTab}
              disabled={isLoading || !activeTab}
              className='p-1.5 rounded hover:bg-border transition-colors disabled:opacity-50'
              title='Refresh'
              data-track-category='Workflows'
              data-track-name='RefreshPreviewTab'
              data-track-metadata={JSON.stringify({ tabId: activeTabId })}
            >
              <RefreshCw
                size={14}
                className={`text-muted-foreground ${isLoading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              onClick={openExternal}
              disabled={!activeTab || activeTab.url === 'about:blank'}
              className='p-1.5 rounded hover:bg-border transition-colors disabled:opacity-50'
              title='Open in browser'
              data-track-category='Workflows'
              data-track-name='OpenPreviewInExternalBrowser'
              data-track-metadata={JSON.stringify({ tabId: activeTabId, url: activeTab?.url })}
            >
              <ExternalLink size={14} className='text-muted-foreground' />
            </button>
          </div>
        </div>
      </div>

      {/* Webview Content Area - renders locally, NOT in sidebar */}
      <div className='flex-1 relative bg-background'>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${activeTabId === tab.id ? 'block' : 'hidden'}`}
          >
            {tab.url === 'about:blank' ? (
              <div className='flex flex-col items-center justify-center h-full text-center p-8'>
                <Globe size={32} className='text-muted mb-3' />
                <p className='text-muted-foreground text-sm'>Enter a URL or wait for a preview</p>
              </div>
            ) : (
              <webview
                ref={el => {
                  if (el) {
                    webviewRefs.current.set(tab.id, el as ElectronWebviewElement);
                  }
                }}
                src={tab.url}
                className='w-full h-full border-0'
                style={{ display: 'flex' }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkflowPreviewPanel;
