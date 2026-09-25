import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElectronWebviewElement } from '../../../types/electron';
import type { AnnotateTransport, CommentMark, PickedBlock, TransportEvents } from './transport';
import type { CommentAnchor } from '../itemComments';
import { ANNOTATE_SCRIPT } from './pageScript';

const DRAIN_MS = 250;

const DRAIN = `(() => {
  const queue = window.__xyneAnnotateQueue || [];
  window.__xyneAnnotateQueue = [];
  return queue;
})()`;

const INSTALLED = `Boolean(window.__xyneAnnotateApply)`;

function run(view: ElectronWebviewElement | null, script: string): Promise<unknown> {
  if (!view) return Promise.resolve(undefined);
  try {
    return view.executeJavaScript(script).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

/** The content is an Electron webview, reached with executeJavaScript. */
export function useWebviewTransport(
  view: ElectronWebviewElement | null,
  events: TransportEvents,
): AnnotateTransport {
  const [ready, setReady] = useState(false);
  const handlers = useRef(events);
  handlers.current = events;

  const apply = useCallback(
    (message: Record<string, unknown>): void => {
      const payload = JSON.stringify({ channel: 'xyne-doc-host', ...message });
      void run(view, `window.__xyneAnnotateApply && window.__xyneAnnotateApply(${payload})`);
    },
    [view],
  );

  useEffect(() => {
    setReady(false);
    if (!view) return;

    let cancelled = false;
    const install = (): void => {
      void run(view, INSTALLED).then(installed => {
        if (cancelled) return;
        if (installed === true) {
          setReady(true);
          handlers.current.onReady?.();
          return;
        }
        // run() swallows both the synchronous throw and the rejection, so the
        // injection's own resolution says nothing about whether it landed —
        // before dom-ready it always fails. Re-probe, or the toggle goes live
        // over a page that has no picker and every click is dropped.
        void run(view, ANNOTATE_SCRIPT)
          .then(() => run(view, INSTALLED))
          .then(confirmed => {
            if (cancelled || confirmed !== true) return;
            setReady(true);
            handlers.current.onReady?.();
          });
      });
    };

    const onLoaded = (): void => install();
    view.addEventListener('dom-ready', onLoaded);
    install();

    return () => {
      cancelled = true;
      view.removeEventListener('dom-ready', onLoaded);
    };
  }, [view]);

  useEffect(() => {
    if (!view || !ready) return;
    const timer = window.setInterval(() => {
      void run(view, DRAIN).then(result => {
        if (!Array.isArray(result)) return;
        for (const message of result as Array<Record<string, unknown>>) {
          const selector = typeof message['selector'] === 'string' ? message['selector'] : '';
          const text = typeof message['text'] === 'string' ? message['text'] : '';
          const id = typeof message['id'] === 'string' ? message['id'] : '';
          if (message['type'] === 'pick' && message['rect']) {
            handlers.current.onPick({
              selector,
              text,
              rect: message['rect'] as PickedBlock['rect'],
            });
          }
          if (message['type'] === 'commentClick' && id) {
            handlers.current.onMarkClick(id, message['rect'] as PickedBlock['rect'] | undefined);
          }
        }
      });
    }, DRAIN_MS);
    return () => window.clearInterval(timer);
  }, [view, ready]);

  return {
    ready,
    setPicking: (on: boolean) => apply({ type: 'pick', on }),
    paintMarks: (marks: readonly CommentMark[]) => apply({ type: 'marks', marks }),
    reveal: (anchor: CommentAnchor) =>
      apply({ type: 'reveal', selector: anchor.selector ?? '', quote: anchor.quote ?? '' }),
    clearHighlight: () => apply({ type: 'clearHighlight' }),
    clearActive: () => apply({ type: 'clearActive' }),
  };
}
