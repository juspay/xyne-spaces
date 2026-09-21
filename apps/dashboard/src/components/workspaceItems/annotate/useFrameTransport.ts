import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotateTransport, CommentMark, PickedBlock, TransportEvents } from './transport';
import type { CommentAnchor } from '../itemComments';

interface DocMessage {
  channel?: string;
  type?: string;
  id?: string;
  selector?: string;
  text?: string;
  rect?: PickedBlock['rect'];
}

/** The content is an iframe this app renders, reached over postMessage. */
export function useFrameTransport(
  frame: HTMLIFrameElement | null,
  events: TransportEvents,
): AnnotateTransport {
  const [ready, setReady] = useState(false);
  const handlers = useRef(events);
  handlers.current = events;

  const post = useCallback(
    (message: Record<string, unknown>): void => {
      frame?.contentWindow?.postMessage({ channel: 'xyne-doc-host', ...message }, '*');
    },
    [frame],
  );

  useEffect(() => {
    setReady(false);
  }, [frame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DocMessage>): void => {
      const data = event.data;
      if (!data || data.channel !== 'xyne-doc') return;
      if (frame?.contentWindow && event.source !== frame.contentWindow) return;

      if (data.type === 'ready') {
        setReady(true);
        handlers.current.onReady?.();
        return;
      }
      if (data.type === 'pick' && data.rect) {
        handlers.current.onPick({
          selector: data.selector ?? '',
          text: data.text ?? '',
          rect: data.rect,
        });
        return;
      }
      if (data.type === 'commentClick' && data.id) {
        handlers.current.onMarkClick(data.id, data.rect);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame]);

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
