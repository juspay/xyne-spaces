import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { logger, Event } from '../../utils/logger';

// Browser context interface for deep link
interface BrowserContextFromDeepLink {
  text: string;
  url: string;
  domain: string;
  title: string;
  timestamp: number;
}

export function BrowserPanelHandler(): null {
  const location = useLocation();
  const isOnBrowserRoute = location.pathname === '/browser';
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );

  // Handle browser panel URL opening
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onOpenInBrowserPanel) return;

    const cleanup = api.onOpenInBrowserPanel((url: string) => {
      xyneAIActor.send({ type: 'CLOSE' });

      logger.info(Event.BROWSER_LINK_CLICK, { url });

      if (browserPanelState === 'open' || isOnBrowserRoute) {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
      } else {
        browserPanelActor.send({ type: 'OPEN', urls: [url] });
      }
    });

    return cleanup;
  }, [isOnBrowserRoute, browserPanelState]);

  // Handle XyneAI context from Chrome extension deep link
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onOpenXyneAIWithContext) return;

    const cleanup = api.onOpenXyneAIWithContext((data: BrowserContextFromDeepLink) => {
      console.log('[BrowserPanelHandler] Received XyneAI context from deep link:', data);

      // Validate context data
      if (!data.text || !data.url) {
        console.warn('[BrowserPanelHandler] Invalid context received');
        return;
      }

      // Close browser panel if open
      if (browserPanelState === 'open') {
        browserPanelActor.send({ type: 'CLOSE' });
      }

      // Open XyneAI sidebar
      xyneAIActor.send({
        type: 'OPEN',
        contextType: 'general',
      });

      // Store the browser context in session storage for XyneAI to pick up
      try {
        const contextPill = {
          type: 'browser',
          text: data.text,
          url: data.url,
          domain: data.domain,
          title: data.title,
          timestamp: data.timestamp || Date.now(),
        };
        sessionStorage.setItem('xyne-ai-browser-context', JSON.stringify(contextPill));

        // Dispatch a custom event that XyneAI can listen to
        window.dispatchEvent(
          new CustomEvent('xyne-ai-browser-context-ready', { detail: contextPill }),
        );

        console.log('[BrowserPanelHandler] Context stored and event dispatched for XyneAI');
      } catch (error) {
        console.error('[BrowserPanelHandler] Failed to store browser context:', error);
      }
    });

    return cleanup;
  }, [browserPanelState]);

  return null;
}
