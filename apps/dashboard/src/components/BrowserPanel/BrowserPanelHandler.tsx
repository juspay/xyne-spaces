import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { isElectronApp } from '../../utils/electronApp';
import { routePopupToEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { keepBrowserTabs } from '../../machines/browserTabsPersistence';
import { keepDownloads } from '../InAppBrowser';
import { browserPages } from '../../routes/BrowserTabsScreen/browserPages';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { logger, Event } from '../../utils/logger';
import { stripUrlQuery } from '../../utils/browserAddress';

export function BrowserPanelHandler(): null {
  const location = useLocation();
  const isOnBrowserRoute = location.pathname === '/browser';
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );

  // The browser's tabs, kept across a reload or a restart.
  useEffect(() => (isElectronApp() ? keepBrowserTabs() : undefined), []);

  // The View menu's zoom (⌘+, ⌘-, ⌘0): the browser's open page while the browser has
  // the keyboard, else the app itself, as the menu did before.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppZoomRequest) return undefined;
    return api.onAppZoomRequest(step => {
      if (!browserPages.zoomOpenPage(step)) api.zoomApp?.(step);
    });
  }, []);

  // The in-app browsers' downloads: saved to Downloads, and said when done.
  useEffect(() => (isElectronApp() ? keepDownloads() : undefined), []);

  // Handle browser panel URL opening
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onOpenInBrowserPanel) return;

    const cleanup = api.onOpenInBrowserPanel(
      (url: string, sourceWebContentsId?: number, disposition?: string) => {
        // A page embedded elsewhere in the app keeps its own popups: following a
        // link inside it should stay where the reader is looking.
        if (routePopupToEmbeddedWebview(url, sourceWebContentsId, disposition)) return;

        xyneAIActor.send({ type: 'CLOSE' });

        logger.info(Event.BROWSER_LINK_CLICK, { url: stripUrlQuery(url), openedIn: 'in-app' });

        if (browserPanelState === 'open' || isOnBrowserRoute) {
          browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
        } else {
          browserPanelActor.send({ type: 'OPEN', urls: [url] });
        }
      },
    );

    return cleanup;
  }, [isOnBrowserRoute, browserPanelState]);

  // Links main routed to the external browser: logged here so external opens are
  // counted alongside the in-app ones above.
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onLinkOpenedExternal) return;

    const cleanup = api.onLinkOpenedExternal((url: string) => {
      logger.info(Event.BROWSER_LINK_CLICK, { url: stripUrlQuery(url), openedIn: 'external' });
    });

    return cleanup;
  }, []);

  return null;
}
