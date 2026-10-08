import { ReactElement, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ArtifactAppHostProps, ArtifactAppPlacement } from './ArtifactAppHostView';
import { artifactAppPool as pool } from './ArtifactAppPool';
import type { SlotProps } from './artifactAppPool.state';

export type { ArtifactAppPlacement };

function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let el = element.parentElement; el && el !== document.body; el = el.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(el);
    if (overflowX !== 'visible' || overflowY !== 'visible') found.push(el);
  }
  return found;
}

/** Reserves this box; ArtifactAppPoolHost draws the app over it and keeps it alive. */
export const ArtifactAppHost = ({
  appId,
  placement,
  showPayloadTitle = false,
  onBack,
}: ArtifactAppHostProps): ReactElement => {
  const slotId = useId();
  const slotRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  const props: SlotProps = { placement, showPayloadTitle, hasBack: Boolean(onBack) };
  const propsRef = useRef(props);
  propsRef.current = props;
  const propsKey = JSON.stringify(props);

  // Layout effect so a returning app never flashes hidden.
  useLayoutEffect(() => pool.mount(slotId, appId, propsRef.current, backRef), [slotId, appId]);

  useEffect(() => {
    pool.update(slotId, appId, { props: propsRef.current });
  }, [slotId, appId, propsKey]);

  useLayoutEffect(() => {
    const element = slotRef.current;
    if (!element) return undefined;

    // The app is drawn above the page, so clip it to what the slot's scroll containers would show.
    const clippers = clippingAncestors(element);
    let last = '';
    const publish = (): void => {
      const { top, left, width, height, right, bottom } = element.getBoundingClientRect();
      let [visTop, visLeft, visRight, visBottom] = [top, left, right, bottom];
      for (const clipper of clippers) {
        const box = clipper.getBoundingClientRect();
        visTop = Math.max(visTop, box.top);
        visLeft = Math.max(visLeft, box.left);
        visRight = Math.min(visRight, box.right);
        visBottom = Math.min(visBottom, box.bottom);
      }
      const clip =
        visRight <= visLeft || visBottom <= visTop
          ? 'inset(100%)'
          : visTop === top && visLeft === left && visRight === right && visBottom === bottom
            ? 'none'
            : `inset(${visTop - top}px ${right - visRight}px ${bottom - visBottom}px ${visLeft - left}px)`;
      const key = `${top},${left},${width},${height},${clip}`;
      if (key === last) return;
      last = key;
      pool.update(slotId, appId, { rect: { top, left, width, height, clip } });
    };
    publish();

    // Polled per frame: a slot can move without any resize or scroll event.
    let frame = requestAnimationFrame(function track() {
      publish();
      frame = requestAnimationFrame(track);
    });
    return (): void => cancelAnimationFrame(frame);
  }, [slotId, appId]);

  return <div ref={slotRef} className='h-full w-full' />;
};
