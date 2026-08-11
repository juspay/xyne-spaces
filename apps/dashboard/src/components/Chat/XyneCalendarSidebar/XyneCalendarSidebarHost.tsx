import { type ReactElement, type ReactNode, useCallback, useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Panel,
  ResizableGroup,
  Separator,
  type PanelImperativeHandle,
} from '../../ui/Resizable/Resizable';
import { XyneCalendarSidebar } from './XyneCalendarSidebar';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION,
  XYNE_CALENDAR_SIDEBAR_MAX_WIDTH,
  XYNE_CALENDAR_SIDEBAR_MIN_WIDTH,
  getXyneCalendarSidebarWidth,
  saveXyneCalendarSidebarWidth,
  useIsXyneCalendarSidebarOpen,
} from './xyneCalendarSidebar.utils';

interface XyneCalendarSidebarHostProps {
  children: ReactNode;
}

export const XyneCalendarSidebarHost = ({
  children,
}: XyneCalendarSidebarHostProps): ReactElement => {
  const isOpen = useIsXyneCalendarSidebarOpen();
  const { isMobile } = usePlatform();
  const shouldReduceMotion = useReducedMotion();

  const panelRef = useRef<PanelImperativeHandle>(null);
  const mainPanelElementRef = useRef<HTMLDivElement>(null);
  const calendarPanelElementRef = useRef<HTMLDivElement>(null);
  const hasOpenedRef = useRef(isOpen);

  // Animate open/close layout changes, then restore instant panel resizing for dragging.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || (!isOpen && !hasOpenedRef.current)) return;
    if (isOpen) hasOpenedRef.current = true;

    const panelElements = [mainPanelElementRef.current, calendarPanelElementRef.current].filter(
      (element): element is HTMLDivElement => element !== null,
    );
    const previousTransitions = panelElements.map(element => element.style.transition);
    const transition = shouldReduceMotion
      ? ''
      : `flex-grow ${XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION}s cubic-bezier(0.22, 1, 0.36, 1)`;

    for (const element of panelElements) element.style.transition = transition;

    const frameId = requestAnimationFrame(() => {
      if (isOpen) {
        panel.resize(getXyneCalendarSidebarWidth());
      } else {
        panel.collapse();
      }
    });

    const restoreTransitions = (): void => {
      panelElements.forEach((element, index) => {
        if (element.style.transition === transition) {
          element.style.transition = previousTransitions[index] ?? '';
        }
      });
    };
    const timeoutId = window.setTimeout(
      restoreTransitions,
      shouldReduceMotion ? 0 : XYNE_CALENDAR_SIDEBAR_ANIMATION_DURATION * 1000 + 50,
    );

    return (): void => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      restoreTransitions();
    };
  }, [isOpen, shouldReduceMotion]);

  const handlePanelResize = useCallback(
    ({ inPixels }: { inPixels: number }): void => {
      if (isOpen && inPixels >= XYNE_CALENDAR_SIDEBAR_MIN_WIDTH) {
        saveXyneCalendarSidebarWidth(inPixels);
      }
    },
    [isOpen],
  );

  if (isMobile) return <>{children}</>;

  return (
    <ResizableGroup orientation='horizontal' className='h-screen w-full overflow-hidden'>
      <Panel id='xyne-calendar-main-content' elementRef={mainPanelElementRef}>
        {children}
      </Panel>

      <Separator
        disabled={!isOpen}
        className={`flex cursor-col-resize items-center justify-center transition-[width,opacity] group ${
          isOpen ? 'w-[2px] opacity-100' : 'w-0 pointer-events-none opacity-0'
        }`}
      >
        <div className='h-full w-[2px] bg-transparent group-hover:bg-primary group-active:bg-primary' />
      </Separator>

      <Panel
        id='xyne-calendar-sidebar'
        panelRef={panelRef}
        elementRef={calendarPanelElementRef}
        defaultSize={0}
        minSize={XYNE_CALENDAR_SIDEBAR_MIN_WIDTH}
        maxSize={XYNE_CALENDAR_SIDEBAR_MAX_WIDTH}
        collapsible
        collapsedSize={0}
        groupResizeBehavior='preserve-pixel-size'
        onResize={handlePanelResize}
      >
        <XyneCalendarSidebar open={isOpen} />
      </Panel>
    </ResizableGroup>
  );
};
