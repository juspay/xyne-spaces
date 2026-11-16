import { ReactElement, useEffect, useLayoutEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { openLink } from '../../utils/openLink';
import { routePopupToEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import { SDLC_WINDOW_NAME } from '../../utils/electronApp';
import { keepDownloads } from '../../components/InAppBrowser';
import { GlobalCallOverlay } from '../../components/Call/CallOverlay/GlobalCallOverlay';

/**
 * An SDLC item in a window of its own, at /newWindow/sdlc/:workspaceId/:channelId/:section.
 * Names the window and hands it to the hub's own route, which renders there without
 * the app's chrome (isSdlcWindow): the item keeps its conversation, threads and Ask
 * AI, and moving around the hub stays in this window.
 */
const SdlcWindow = (): ReactElement => {
  const { workspaceId, channelId, section } = useParams<{
    workspaceId: string;
    channelId: string;
    section: string;
  }>();
  const location = useLocation();

  // Before the redirect lands, so the hub's route already knows where it is.
  useLayoutEffect(() => {
    window.name = SDLC_WINDOW_NAME;
  }, []);

  return (
    <Navigate
      replace
      to={`/${workspaceId}/sdlc/${channelId}/${section}${location.search}${location.hash}`}
    />
  );
};

/** What a window of its own needs that the main window's handlers give it there. */
export const SdlcWindowHost = (): ReactElement => {
  /**
   * Popups from a page embedded in this window.
   *
   * Main denies every popup a webview asks for and forwards the url to the
   * window that embedded it. In the app's main window BrowserPanelHandler picks
   * that up and offers it to the embedded webview before falling back to the
   * browser panel — but this window has no browser panel, so here there is
   * nobody else to offer it to.
   */
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onOpenInBrowserPanel) return;
    return api.onOpenInBrowserPanel((url: string, sourceWebContentsId?: number) => {
      if (routePopupToEmbeddedWebview(url, sourceWebContentsId)) return;
      // Nothing embedded here claimed it and this window has no browser panel,
      // so the system browser is the only place left for it to go.
      openLink(url, null, { force: 'external' });
    });
  }, []);

  // Downloads from this window's pages: saved to Downloads, marked as from the
  // internet, and said when done — as in the main window.
  useEffect(() => keepDownloads(), []);

  // The View menu's zoom (⌘+, ⌘-, ⌘0) when no page here has the keyboard: this
  // window has no browser bar of its own, so the window itself, as before.
  useEffect(() => {
    const api = window.electronAPI;
    return api?.onAppZoomRequest?.(step => api.zoomApp?.(step));
  }, []);

  // roomActor is a module singleton, so this window needs its own.
  return <GlobalCallOverlay autoJoinOnAccept={false} />;
};

export default SdlcWindow;
