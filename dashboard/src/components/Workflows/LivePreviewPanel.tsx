import React, { useEffect, useRef } from 'react';
import { Globe, ExternalLink } from 'lucide-react';
import { isElectronApp } from '../../utils/electronApp';
import { useLocation } from 'react-router-dom';

interface LivePreviewPanelProps {
  url: string;
  userAgent: string;
  isActive?: boolean;
}

function getWindowRelativeBounds(el: HTMLDivElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

const LivePreviewPanel: React.FC<LivePreviewPanelProps> = ({ url, userAgent, isActive = true }) => {
  const previewUrl = `${url}`;
  const platform = isElectronApp() ? 'electron' : 'browser';
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  userAgent = userAgent.split('/')[1] || userAgent;

  const location = useLocation();

  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.hideBrowserView === 'function') {
      window.electronAPI.hideBrowserView();
    }
  }, [location.pathname]);

  // Use BrowserView for Electron to support OAuth properly
  useEffect(() => {
    if (platform !== 'electron' || !previewContainerRef.current || !window.electronAPI) {
      if (
        platform === 'electron' &&
        !isActive &&
        typeof window.electronAPI?.hideBrowserView === 'function'
      ) {
        window.electronAPI.hideBrowserView();
      }
      return;
    }

    // 🔑 NEW: If this panel is not active, hide BrowserView and exit
    if (!isActive) {
      if (typeof window.electronAPI.hideBrowserView === 'function') {
        window.electronAPI.hideBrowserView();
      }
      return;
    }

    const container = previewContainerRef.current;
    if (typeof window.electronAPI.showBrowserView === 'function') {
      window.electronAPI.showBrowserView({
        url: previewUrl,
        userAgent,
        bounds: getWindowRelativeBounds(container),
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (typeof window.electronAPI?.updateBrowserViewBounds === 'function') {
        window.electronAPI.updateBrowserViewBounds({
          bounds: getWindowRelativeBounds(container),
        });
      }
    });

    resizeObserver.observe(container);

    return (): void => {
      resizeObserver.disconnect();
      if (typeof window.electronAPI?.hideBrowserView === 'function') {
        window.electronAPI.hideBrowserView();
      }
    };
  }, [previewUrl, userAgent, platform, isActive]);

  return (
    <div className='h-full flex flex-col bg-white'>
      {/* Header */}
      <div className='flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50'>
        <div className='flex items-center gap-2 text-sm text-gray-600'>
          <Globe className='w-4 h-4' />
          <span>Live Preview</span>
          <span className='px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono'>
            {userAgent}
          </span>
        </div>
        <a
          href={previewUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800'
        >
          <ExternalLink className='w-4 h-4' />
          Open in new tab
        </a>
      </div>

      {/* Preview container */}
      <div className='flex-1' ref={previewContainerRef}>
        {platform === 'browser' && (
          <iframe
            src={previewUrl}
            className='w-full h-full border-0'
            title='Live Preview'
            sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
          />
        )}
        {/* For Electron: BrowserView is controlled by main process, rendered over this div */}
      </div>
    </div>
  );
};

export default LivePreviewPanel;
