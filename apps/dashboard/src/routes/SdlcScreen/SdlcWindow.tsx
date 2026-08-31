import { ReactElement, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { SDLC_APP_BASE_PATH } from '../../config';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { parseSdlcFrameMessage, SDLC_FRAME_MESSAGE } from './sdlcFrameMessages';
import { SDLC_WINDOW_FRAME_NAME } from './useSdlcFrameBridge';

/**
 * The SDLC lane as a whole window, at /newWindow/sdlc/:workspaceId/:repoId/:section.
 * Hosts the same iframe SdlcFrameHost does, without its viewport and portal: here
 * the frame is the window, so it is never hidden or reparented.
 */
const SdlcWindow = (): ReactElement => {
  const { workspaceId, repoId, section } = useParams<{
    workspaceId: string;
    repoId: string;
    section: string;
  }>();
  const location = useLocation();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const { initiateCall } = useCallJoinOrInitiate();
  const initiateCallRef = useRef(initiateCall);
  initiateCallRef.current = initiateCall;

  const [src, setSrc] = useState(
    () => `${SDLC_APP_BASE_PATH}/${workspaceId}/sdlc/${repoId}/${section}${location.search}`,
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

      if (message.type === SDLC_FRAME_MESSAGE.reset) {
        setSrc(`${SDLC_APP_BASE_PATH}/${workspaceId}/sdlc?_reset=${Date.now()}`);
        setResetCount(count => count + 1);
      }
    };

    window.addEventListener('message', onMessage);
    return (): void => window.removeEventListener('message', onMessage);
  }, [workspaceId]);

  return (
    <iframe
      key={resetCount}
      ref={iframeRef}
      src={src}
      title='SDLC'
      name={SDLC_WINDOW_FRAME_NAME}
      className='h-full w-full border-0'
      allow='clipboard-read; clipboard-write'
    />
  );
};

export default SdlcWindow;
