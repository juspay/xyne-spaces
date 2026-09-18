import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnnotateTransport,
  CommentAnchor,
  CommentMark,
  PickedBlock,
  TransportEvents,
} from '../../components/workspaceItems';
import { SDLC_FRAME_MESSAGE, parseSdlcFrameMessage } from './sdlcFrameMessages';

/**
 * The content is a page the host window holds over a hole in this frame, so
 * nothing here can reach it directly. The host evaluates on our behalf and
 * relays what the page reports back; the annotator above cannot tell.
 */
export function useBridgeTransport(enabled: boolean, events: TransportEvents): AnnotateTransport {
  const [ready, setReady] = useState(false);
  const handlers = useRef(events);
  handlers.current = events;

  const post = useCallback(
    (payload: Record<string, unknown>): void => {
      if (!enabled) return;
      window.parent.postMessage(
        { type: SDLC_FRAME_MESSAGE.embedScript, payload: { channel: 'xyne-doc-host', ...payload } },
        window.location.origin,
      );
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const message = parseSdlcFrameMessage(event.data);
      if (!message || message.type !== SDLC_FRAME_MESSAGE.embedEvent) return;
      const payload = message.payload;

      if (payload['type'] === 'ready') {
        setReady(true);
        handlers.current.onReady?.();
        return;
      }
      if (payload['type'] === 'pick' && payload['rect']) {
        handlers.current.onPick({
          selector: typeof payload['selector'] === 'string' ? payload['selector'] : '',
          text: typeof payload['text'] === 'string' ? payload['text'] : '',
          rect: payload['rect'] as PickedBlock['rect'],
        });
        return;
      }
      if (payload['type'] === 'commentClick' && typeof payload['id'] === 'string') {
        handlers.current.onMarkClick(
          payload['id'],
          payload['rect'] as PickedBlock['rect'] | undefined,
        );
      }
    };
    window.addEventListener('message', onMessage);
    // Speak once so the host installs the script and reports back; until the
    // page answers there is nothing to annotate and the toggle stays hidden.
    post({ type: 'ping' });
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, post]);

  return {
    ready,
    setPicking: (on: boolean) => post({ type: 'pick', on }),
    paintMarks: (marks: readonly CommentMark[]) => post({ type: 'marks', marks }),
    reveal: (anchor: CommentAnchor) =>
      post({ type: 'reveal', selector: anchor.selector ?? '', quote: anchor.quote ?? '' }),
    clearHighlight: () => post({ type: 'clearHighlight' }),
    clearActive: () => post({ type: 'clearActive' }),
  };
}
