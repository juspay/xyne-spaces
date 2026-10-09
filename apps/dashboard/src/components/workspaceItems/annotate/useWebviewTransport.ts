import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElectronWebviewElement } from '../../../types/electron';
import {
  measuredRect,
  rectOnScreen,
  type AnnotateTransport,
  type CommentMark,
  type TransportEvents,
} from './transport';
import type { CommentAnchor } from '../itemComments';
import { ANNOTATE_SCRIPT, annotateEventFrom } from './pageScript';

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

  // A pick or a badge click, said by the page as the reader makes it.
  useEffect(() => {
    if (!view || !ready) return;
    const onConsole = (event: Event): void => {
      const message = annotateEventFrom((event as Event & { message?: string }).message);
      if (!message) return;
      // The page measures in its own zoomed units; the box and threads drawn
      // beside a block go by the app's.
      let zoom = 1;
      try {
        zoom = view.getZoomFactor?.() ?? 1;
      } catch {
        /* not attached yet: as measured */
      }
      const selector = typeof message['selector'] === 'string' ? message['selector'] : '';
      const text = typeof message['text'] === 'string' ? message['text'] : '';
      const id = typeof message['id'] === 'string' ? message['id'] : '';
      const rect = measuredRect(message['rect']);
      if (message['type'] === 'pick' && rect) {
        handlers.current.onPick({ selector, text, rect: rectOnScreen(rect, zoom) });
      }
      if (message['type'] === 'commentClick' && id) {
        handlers.current.onMarkClick(id, rect ? rectOnScreen(rect, zoom) : undefined);
      }
    };
    view.addEventListener('console-message', onConsole);
    return () => view.removeEventListener('console-message', onConsole);
  }, [view, ready]);

  // The same functions from one render to the next, for as long as the page is: a
  // viewer's effects keyed on them run when the page changes, not on every render —
  // its comments were fetched again on each one.
  return useMemo(
    () => ({
      ready,
      setPicking: (on: boolean) => apply({ type: 'pick', on }),
      paintMarks: (marks: readonly CommentMark[]) => apply({ type: 'marks', marks }),
      reveal: (anchor: CommentAnchor) =>
        apply({ type: 'reveal', selector: anchor.selector ?? '', quote: anchor.quote ?? '' }),
      clearHighlight: () => apply({ type: 'clearHighlight' }),
      clearActive: () => apply({ type: 'clearActive' }),
    }),
    [ready, apply],
  );
}
