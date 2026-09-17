import { ReactElement, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { SDLC_APP_BASE_PATH } from '../../config';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { openLink } from '../../utils/openLink';
import { routePopupToEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import { SdlcEmbeddedWebview } from './SdlcEmbeddedWebview';
import { parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';
import { SDLC_WINDOW_FRAME_NAME } from './useSdlcFrameBridge';

/**
 * The SDLC lane as a whole window, at /newWindow/sdlc/:workspaceId/:channelId/:section.
 * Hosts the same iframe SdlcFrameHost does, without its viewport and portal: here
 * the frame is the window, so it is never hidden or reparented.
 */
const SdlcWindow = (): ReactElement => {
  const { workspaceId, channelId, section } = useParams<{
    workspaceId: string;
    channelId: string;
    section: string;
  }>();
  const location = useLocation();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const { initiateCall } = useCallJoinOrInitiate();
  const initiateCallRef = useRef(initiateCall);
  initiateCallRef.current = initiateCall;

  const [src, setSrc] = useState(
    () => `${SDLC_APP_BASE_PATH}/${workspaceId}/sdlc/${channelId}/${section}${location.search}`,
  );
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

      const message = parseSdlcFrameMessage(event.data);
      if (!message) return;

      if (message.type === SDLC_FRAME_MESSAGE.initiateCall) {
        initiateCallRef.current({
          channelId: message.channelId,
          ...(message.targetUserIds && { targetUserIds: message.targetUserIds }),
          ...(message.callDisplayName && { callDisplayName: message.callDisplayName }),
          ...(message.conversationId && { conversationId: message.conversationId }),
          ...(message.sdlcLink && { sdlcLink: message.sdlcLink }),
        });
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.openLink) {
        // Forced in-app: the lane asked for this because it wants the link in
        // the app, not handed to the operating system.
        openLink(message.url, null, { force: 'in-app' });
        return;
      }

      if (message.type === SDLC_FRAME_MESSAGE.reset) {
        setSrc(`${SDLC_APP_BASE_PATH}/${workspaceId}/sdlc?_reset=${Date.now()}`);
        setResetCount(count => count + 1);
      }
    };

    window.addEventListener('message', onMessage);
    return (): void => window.removeEventListener('message', onMessage);
  }, [workspaceId]);

  /**
   * Popups from a page embedded in this window.
   *
   * Main denies every popup a webview asks for and forwards the url to the
   * window that embedded it. In the app's main window BrowserPanelHandler picks
   * that up and offers it to the embedded webview before falling back to the
   * browser panel — but this route renders SdlcWindow alone, without AppRoot, so
   * here there is nobody to offer it to and the click was being dropped.
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

  return (
    <div className='relative h-full w-full'>
      <iframe
        key={resetCount}
        ref={iframeRef}
        src={src}
        title='SDLC'
        name={SDLC_WINDOW_FRAME_NAME}
        className='h-full w-full border-0'
        allow='clipboard-read; clipboard-write'
      />
      {/* The window fills its wrapper, so the frame's own coordinates are the
          wrapper's; no offset to add. */}
      <SdlcEmbeddedWebview
        offset={{ top: 0, left: 0 }}
        getFrameWindow={() => iframeRef.current?.contentWindow ?? null}
      />
    </div>
  );
};

export default SdlcWindow;
