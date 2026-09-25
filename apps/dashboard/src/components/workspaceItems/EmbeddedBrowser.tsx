import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { isElectronApp } from '../../utils/electronApp';
import { pickWebviewPartition } from '../../utils/browserPanelPartition';
import { registerEmbeddedWebview } from '../../utils/embeddedWebviewRegistry';
import type { ElectronWebviewElement } from '../../types/electron';
import { SandboxedFrame } from './primitives';
import {
  canHostEmbedPages,
  embedPageOverElement,
  reclaimHostFocus,
} from '../../routes/SdlcScreen/useSdlcFrameBridge';

export interface EmbeddedBrowserProps {
  url: string;
  title: string;
  /** Rendered above the page, for a surface's own notice or offer. */
  banner?: (view: ElectronWebviewElement | null) => ReactNode;
  /** Rendered over the page, for a surface's own controls. */
  overlay?: (view: ElectronWebviewElement | null) => ReactNode;
  /** Called with the live webview, and with null when it goes away. */
  onView?: (view: ElectronWebviewElement | null) => void;
  /** Called on every navigation, with the url the page moved to. */
  onNavigate?: (url: string) => void;
}

/**
 * A page held by the host window, over a hole this element leaves. Used when the
 * surface is inside a frame, where a webview of its own cannot live.
 */
function HostedPage({ url }: { url: string }): ReactElement {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element) return undefined;
    return embedPageOverElement(url, element);
  }, [url, element]);

  return <div ref={setElement} className='h-full w-full bg-background' />;
}

export function EmbeddedBrowser({
  url,
  title,
  banner,
  overlay,
  onView,
  onNavigate,
}: EmbeddedBrowserProps): ReactElement {
  const [view, setView] = useState<ElectronWebviewElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const releaseFocus = useCallback((): void => {
    reclaimHostFocus();
    void window.electronAPI?.focusHostWebContents?.();
  }, []);

  const attach = useCallback(
    (el: HTMLElement | null) => {
      const next = el ? (el as ElectronWebviewElement) : null;
      setView(next);
      onView?.(next);
    },
    [onView],
  );

  useEffect(() => {
    if (!view) return;

    const navigated = (): void => {
      try {
        onNavigate?.(view.getURL());
      } catch {
        /* the guest is gone or not ready; the next navigation reports it */
      }
    };
    view.addEventListener('did-navigate', navigated);
    view.addEventListener('did-navigate-in-page', navigated);

    let unregister = (): void => undefined;
    const claimPopups = (): void => {
      const id = view.getWebContentsId?.();
      if (typeof id !== 'number') return;
      unregister();
      unregister = registerEmbeddedWebview(id, next => {
        void view.loadURL(next);
      });
    };
    view.addEventListener('dom-ready', claimPopups);

    return () => {
      view.removeEventListener('did-navigate', navigated);
      view.removeEventListener('did-navigate-in-page', navigated);
      view.removeEventListener('dom-ready', claimPopups);
      unregister();
    };
  }, [view, onNavigate]);

  useEffect(() => {
    if (!host) return;
    let outside = false;
    const onMove = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      const isOutside = !target || !host.contains(target);
      if (isOutside === outside) return;
      outside = isOutside;
      if (isOutside) releaseFocus();
    };
    window.addEventListener('pointermove', onMove, true);
    return () => window.removeEventListener('pointermove', onMove, true);
  }, [host, releaseFocus]);

  if (canHostEmbedPages()) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        {banner?.(null)}
        <div ref={setHost} className='relative min-h-0 flex-1' onPointerLeave={releaseFocus}>
          <HostedPage url={url} />
          {overlay?.(null)}
        </div>
      </div>
    );
  }

  if (!isElectronApp()) {
    return <SandboxedFrame url={url} title={title} />;
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {banner?.(view)}
      <div ref={setHost} className='relative min-h-0 flex-1' onPointerLeave={releaseFocus}>
        <webview
          {...({
            ref: attach,
            src: url,
            allowpopups: '',
            partition: pickWebviewPartition(url),
            className: 'h-full w-full border-0 bg-background',
          } as Record<string, unknown>)}
        />
        {overlay?.(view)}
      </div>
    </div>
  );
}
