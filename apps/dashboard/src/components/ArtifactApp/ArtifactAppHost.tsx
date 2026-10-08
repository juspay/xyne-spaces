import { ReactElement, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ArtifactAppHostProps, ArtifactAppPlacement } from './ArtifactAppHostView';
import { artifactAppPool as pool } from './ArtifactAppPool';
import { poolKey, type SlotProps } from './artifactAppPool.state';

export type { ArtifactAppPlacement };

/** Frames a slot must stay still before per-frame polling stops. */
const SETTLE_FRAMES = 10;

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
  const key = poolKey(appId, placement);

  const props: SlotProps = { placement, showPayloadTitle, hasBack: Boolean(onBack) };
  const propsRef = useRef(props);
  propsRef.current = props;
  const propsKey = JSON.stringify(props);

  // Layout effect so a returning app never flashes hidden.
  useLayoutEffect(
    () => pool.mount(slotId, key, appId, propsRef.current, backRef),
    [slotId, key, appId],
  );

  useEffect(() => {
    pool.update(slotId, key, { props: propsRef.current });
  }, [slotId, key, propsKey]);

  useLayoutEffect(() => {
    const element = slotRef.current;
    if (!element) return undefined;

    // The app is drawn above the page, so clip it to what the slot's scroll containers would show.
    let clippers = clippingAncestors(element);
    let last = '';
    const publish = (): boolean => {
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
      const next = `${top},${left},${width},${height},${clip}`;
      if (next === last) return false;
      last = next;
      pool.update(slotId, key, { rect: { top, left, width, height, clip } });
      return true;
    };

    // Measure on layout signals, then follow per frame until the slot settles (a drag or transition moves it for a while).
    let frame = 0;
    let still = 0;
    const follow = (): void => {
      still = 0;
      if (frame) return;
      const tick = (): void => {
        still = publish() ? 0 : still + 1;
        frame = still < SETTLE_FRAMES ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    };
    const relayout = (): void => {
      clippers = clippingAncestors(element);
      follow();
    };

    // Ancestors too: content shifting above the slot resizes one of them without resizing the slot.
    const observer = new ResizeObserver(relayout);
    for (let el: HTMLElement | null = element; el; el = el.parentElement) observer.observe(el);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    document.addEventListener('transitionrun', follow, true);
    document.addEventListener('animationstart', follow, true);
    publish();

    return (): void => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      document.removeEventListener('transitionrun', follow, true);
      document.removeEventListener('animationstart', follow, true);
    };
  }, [slotId, key]);

  return <div ref={slotRef} className='h-full w-full' />;
};
