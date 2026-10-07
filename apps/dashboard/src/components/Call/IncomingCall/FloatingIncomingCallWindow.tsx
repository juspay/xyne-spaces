import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

/** Must match the prefix the desktop app turns into the floating panel. */
const INCOMING_CALL_FRAME_PREFIX = 'xyne-incoming-call:';

/**
 * `window.open('', name)` hands back any open window with that name — including
 * one whose close is still in flight — so every open gets a fresh name.
 */
let openCount = 0;

/** Whether this desktop build can float the incoming-call card. */
export function canFloatIncomingCall(): boolean {
  return typeof window.electronAPI?.incomingCallWindow?.bringAppToFront === 'function';
}

/** The page's styles and theme, as the floating window needs them. */
function copyStylesheet(node: Element, into: Document): void {
  const copy = node.cloneNode(true) as HTMLElement;
  // about:blank must not be trusted to resolve the app's relative URLs.
  if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href;
  into.head.appendChild(copy);
}

function copyThemeAttributes(into: Document): void {
  const source = document.documentElement;
  into.documentElement.className = source.className;
  for (const { name, value } of Array.from(source.attributes)) {
    if (name.startsWith('data-') || name === 'style') {
      into.documentElement.setAttribute(name, value);
    }
  }
}

/**
 * Opens the desktop app's floating incoming-call window and hands its body to
 * `children`, which render the app's own card into it. The window is opened on
 * about:blank from this page, so it shares this page's JavaScript: same users,
 * avatars and handlers, nothing copied over IPC. The desktop app only makes it
 * float; it is closed on unmount. Mount one per call (key it by call id).
 */
export function FloatingIncomingCallWindow({
  children,
  onUnavailable,
}: {
  children: (container: HTMLElement) => ReactNode;
  /**
   * The window could not be opened, or was closed by something other than
   * this component (the desktop app's lifetime backstop); the caller falls back
   * to the OS notification.
   */
  onUnavailable: () => void;
}): ReactElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    openCount += 1;
    const popup = window.open('', `${INCOMING_CALL_FRAME_PREFIX}${openCount}`);
    if (!popup) {
      onUnavailableRef.current();
      return undefined;
    }

    const doc = popup.document;
    doc.title = 'Incoming call';
    doc.head.replaceChildren();
    doc.body.replaceChildren();

    // The card is styled by the app's stylesheets and theme, so the window
    // takes both, and keeps taking them while it is open: a theme switch
    // mid-ring, or styles added after it opened, reach the card too.
    document
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach(node => copyStylesheet(node, doc));
    copyThemeAttributes(doc);
    const sync = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          copyThemeAttributes(doc);
        } else {
          mutation.addedNodes.forEach(node => {
            if (
              node instanceof HTMLStyleElement ||
              (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
            ) {
              copyStylesheet(node, doc);
            }
          });
        }
      }
    });
    sync.observe(document.documentElement, { attributes: true });
    sync.observe(document.head, { childList: true });

    // The window is transparent: only the card, which centres itself, shows.
    const transparent = doc.createElement('style');
    transparent.textContent =
      'html,body{background:transparent!important;margin:0;overflow:hidden}';
    doc.head.appendChild(transparent);

    // Closed from outside (the desktop app's backstop, an opener reload): stop
    // rendering into it and let the caller fall back, instead of drawing into
    // a dead window while the call shows nowhere.
    let closingOurselves = false;
    const onClosed = (): void => {
      if (closingOurselves) return;
      sync.disconnect();
      setContainer(null);
      onUnavailableRef.current();
    };
    popup.addEventListener('pagehide', onClosed);

    setContainer(doc.body);

    return (): void => {
      closingOurselves = true;
      sync.disconnect();
      setContainer(null);
      popup.close();
    };
  }, []);

  return container ? <>{children(container)}</> : null;
}

/**
 * Who floats the card for this window, asked fresh for each ring: whether this
 * is the desktop app's main window, and whether a main window exists at all.
 * `undefined` until the desktop app answers.
 */
export function useFloatingHost(
  enabled: boolean,
): { isMain: boolean; mainExists: boolean } | undefined {
  const [host, setHost] = useState<{ isMain: boolean; mainExists: boolean } | undefined>(undefined);

  useEffect(() => {
    const bridge = window.electronAPI?.incomingCallWindow;
    if (!enabled || !bridge) return undefined;
    let cancelled = false;
    void bridge.getHost().then(value => {
      if (!cancelled) setHost(value);
    });
    return (): void => {
      cancelled = true;
      // The main window can close between rings; the next ring asks again.
      setHost(undefined);
    };
  }, [enabled]);

  return host;
}

/**
 * Whether any Xyne app window has focus, as the desktop app sees it.
 * `undefined` until the first answer arrives, so nothing floats on a guess.
 */
export function useIsAppFocused(enabled: boolean): boolean | undefined {
  const [focused, setFocused] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const bridge = window.electronAPI?.incomingCallWindow;
    if (!enabled || !bridge) return undefined;

    let cancelled = false;
    void bridge.isAppFocused().then(value => {
      // A live event that landed while the query was in flight is newer.
      if (!cancelled) setFocused(value);
    });
    const unsubscribe = bridge.onAppFocusChanged(value => {
      cancelled = true;
      setFocused(value);
    });

    return (): void => {
      cancelled = true;
      unsubscribe();
      // Not listened to between rings, so the last answer goes stale: the next
      // ring must ask again rather than float over a Xyne the user went back to.
      setFocused(undefined);
    };
  }, [enabled]);

  return focused;
}
