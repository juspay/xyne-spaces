import { ReactElement, useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ArtifactAppHostProps, ArtifactAppPlacement } from './ArtifactAppHostView';
import { artifactAppPool as pool } from './ArtifactAppPool';
import type { SlotProps } from './artifactAppPool.state';

export type { ArtifactAppPlacement };

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

    let last = '';
    const publish = (): void => {
      const { top, left, width, height } = element.getBoundingClientRect();
      const key = `${top},${left},${width},${height}`;
      if (key === last) return;
      last = key;
      pool.update(slotId, appId, { rect: { top, left, width, height } });
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
