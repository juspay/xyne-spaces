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

      logger.info(Event.BROWSER_LINK_CLICK, { url, openedIn: 'in-app' });

      if (browserPanelState === 'open' || isOnBrowserRoute) {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
      } else {
        browserPanelActor.send({ type: 'OPEN', urls: [url] });
      }
    });

    return cleanup;
  }, [isOnBrowserRoute, browserPanelState]);

  // Links main routed to the external browser: logged here so external opens are
  // counted alongside the in-app ones above.
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onLinkOpenedExternal) return;

    const cleanup = api.onLinkOpenedExternal((url: string) => {
      logger.info(Event.BROWSER_LINK_CLICK, { url, openedIn: 'external' });
    });

    return cleanup;
  }, []);

  // Handle XyneAI context from Chrome extension deep link
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onOpenXyneAIWithContext) return;

    const cleanup = api.onOpenXyneAIWithContext((data: BrowserContextFromDeepLink) => {
      logger.info(Event.FRONTEND_ERROR, {
        type: 'migrated_console_log',
        message: String('[BrowserPanelHandler] Received XyneAI context from deep link:'),
        context: [data],
      });

      // Validate context data
      if (!data.text || !data.url) {
        logger.warn(Event.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[BrowserPanelHandler] Invalid context received'),
        });
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

        logger.info(Event.FRONTEND_ERROR, {
          type: 'migrated_console_log',
          message: String('[BrowserPanelHandler] Context stored and event dispatched for XyneAI'),
        });
      } catch (error) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[BrowserPanelHandler] Failed to store browser context:'),
          error: error,
        });
      }
    });

    return cleanup;
  }, [browserPanelState]);

  return null;
}
