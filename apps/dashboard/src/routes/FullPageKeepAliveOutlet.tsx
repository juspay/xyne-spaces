import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ContextType,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  useLocation,
  useOutlet,
} from 'react-router-dom';
import {
  COLLAPSE_TO_CMDK_EVENT,
  isFullPageSearchPath,
  KEPT_PAGE_ATTR,
  KEPT_DRAWN_ATTR,
  RESULTS_PAGE_ATTR,
} from '../components/Chat/ChatDirectory/cmdkFullPage';
import { useScope } from '../shortcuts';
import { createPageCoverage, PageCoveredContext } from '../hooks/usePageCoverage';

const CONTENTS = { display: 'contents' } as const;

// What a page reads of the router: where it is, and the router's state (navigations in flight,
// matches). The page under full page keeps both as they were when it was last on screen.
interface RouterView {
  location: ContextType<typeof UNSAFE_LocationContext>;
  routerState: ContextType<typeof UNSAFE_DataRouterStateContext>;
}

// Route outlet that keeps the page full page opened from mounted (inert, frozen router, skipped
// while full page opens) under a fixed results layer: the overlay-route pattern.
export function FullPageKeepAliveOutlet(): ReactElement {
  const outlet = useOutlet();
  const view: RouterView = {
    location: useContext(UNSAFE_LocationContext),
    routerState: useContext(UNSAFE_DataRouterStateContext),
  };
  const { pathname } = useLocation();
  const onFullPage = isFullPageSearchPath(pathname);

  // The page under full page — the last one outside it that was on screen — and the router as it
  // saw it then. Kept once committed: a render the router abandons (an interrupted navigation)
  // must not become the page under full page.
  const backgroundRef = useRef<{ outlet: ReactElement | null; view: RouterView }>({
    outlet: null,
    view,
  });
  useLayoutEffect(() => {
    if (!onFullPage) backgroundRef.current = { outlet, view };
  });
  const background = onFullPage ? backgroundRef.current : { outlet, view };

  // Drawn again under a settled full page (see KEPT_DRAWN_ATTR); back off full page it is simply
  // on screen, and the next full page starts it undrawn.
  const keptRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!onFullPage) keptRef.current?.removeAttribute(KEPT_DRAWN_ATTR);
  }, [onFullPage]);

  // Tells the page underneath it is covered (usePageCoverage) without re-rendering it. Passive, so
  // a page that unmounts as full page closes — the user went on somewhere else — still reads as
  // covered in its cleanup: it was never seen again.
  const [coverage] = useState(createPageCoverage);
  useEffect(() => coverage.set(onFullPage), [coverage, onFullPage]);
  // A collapse is this page coming back: uncovered from its first frame, so nothing owed for having
  // been covered is written in the middle of the collapse.
  useEffect(() => {
    if (!onFullPage) return;
    const uncover = (): void => coverage.set(false);
    window.addEventListener(COLLAPSE_TO_CMDK_EVENT, uncover);
    return (): void => window.removeEventListener(COLLAPSE_TO_CMDK_EVENT, uncover);
  }, [coverage, onFullPage]);

  return (
    <>
      <div
        ref={keptRef}
        {...{ [KEPT_PAGE_ATTR]: '' }}
        style={CONTENTS}
        inert={onFullPage}
        aria-hidden={onFullPage || undefined}
      >
        <PageCoveredContext.Provider value={coverage}>
          <UNSAFE_DataRouterStateContext.Provider value={background.view.routerState}>
            <UNSAFE_LocationContext.Provider value={background.view.location}>
              {background.outlet}
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_DataRouterStateContext.Provider>
        </PageCoveredContext.Provider>
      </div>
      {onFullPage ? <FullPageLayer>{outlet}</FullPageLayer> : null}
    </>
  );
}

/**
 * Full page, over the route area: fixed to the `<main>` box, following it as panels resize, so the
 * route area's own layout is untouched. The area holds still under it — nothing scrolls the page
 * underneath out from beneath the layer — until full page closes.
 */
function FullPageLayer({ children }: { children: ReactNode }): ReactElement {
  useScope('modal');
  const layerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const area = layer?.parentElement;
    if (!layer || !area) return;
    const place = (): void => {
      const box = area.getBoundingClientRect();
      layer.style.top = `${box.top}px`;
      layer.style.left = `${box.left}px`;
      layer.style.width = `${box.width}px`;
      layer.style.height = `${box.height}px`;
      layer.style.borderRadius = getComputedStyle(area).borderRadius;
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(area);
    window.addEventListener('resize', place);
    const { overflow } = area.style;
    area.style.overflow = 'hidden';
    return (): void => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      area.style.overflow = overflow;
    };
  }, []);
  return (
    <div
      ref={layerRef}
      {...{ [RESULTS_PAGE_ATTR]: '' }}
      // Over the page underneath; under the palette, dialogs and popovers.
      className='fixed z-40 overflow-hidden bg-background'
    >
      {children}
    </div>
  );
}
