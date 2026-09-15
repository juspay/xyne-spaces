import { ReactElement, useEffect, useRef } from 'react';
import { useSdlcFrame } from './SdlcFrameContext';

/**
 * The /sdlc route element in the main bundle. Reports where the frame should
 * appear and, by unmounting, that it should be hidden. Never mounts the frame
 * itself — see SdlcFrameHost.
 */
const SdlcFrameViewport = (): ReactElement => {
  const { setViewport } = useSdlcFrame();
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = slotRef.current;
    if (!element) return undefined;

    const publish = (): void => {
      const rect = element.getBoundingClientRect();
      setViewport({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    publish();

    // Catches the AI drawer / debugger panel resizing the content area.
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    // A position change with no size change would not trigger the observer.
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      // Hides the frame without unmounting it.
      setViewport(null);
    };
  }, [setViewport]);

  return <div ref={slotRef} className='h-full w-full' />;
};

export default SdlcFrameViewport;
