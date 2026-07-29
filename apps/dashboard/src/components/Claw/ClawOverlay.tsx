import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'framer-motion';
import { cn } from '../../utils/classNames';
import {
  CORNER_RADII,
  DEFAULT_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  PANEL,
  PANEL_TOP_MARGIN,
  PILL,
  PILL_THINKING,
  SHADOW_GUTTER,
} from './claw.constants';
import { isExternalHttpHref } from './claw.utils';
import { CLOSE_SPRING, OPEN_SPRING } from './claw.motion';
import { useClawOverlayBridge } from './useClawOverlayBridge';
import { ClawConversationProvider, useClawTabStatus } from './ClawConversationContext';
import { ClawPill } from './ClawPill';
import { ClawPeekBubble } from './ClawPeekBubble';
import { ClawChat } from './ClawChat/ClawChat';
import { xyneAIStreamManager } from '../../services/XyneAI';
import './claw.css';

function ClawThinkingProbe({ onChange }: { onChange: (thinking: boolean) => void }): null {
  const { isStreaming } = useClawTabStatus();
  useEffect(() => {
    onChange(isStreaming);
  }, [isStreaming, onChange]);
  return null;
}

function clampPanelHeight(height: number): number {
  const availHeight =
    typeof window !== 'undefined' && window.screen ? window.screen.availHeight : 900;
  const max = Math.max(MIN_PANEL_HEIGHT, availHeight - SHADOW_GUTTER - PANEL_TOP_MARGIN);
  return Math.min(Math.max(Math.round(height), MIN_PANEL_HEIGHT), max);
}

export function ClawOverlay(): React.ReactElement {
  const bridge = useClawOverlayBridge();
  const reduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number>(DEFAULT_PANEL_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const panelHeightRef = useRef(panelHeight);
  panelHeightRef.current = panelHeight;
  const isResizingRef = useRef(isResizing);
  isResizingRef.current = isResizing;
  const resizeStartRef = useRef<{ screenY: number; height: number } | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingHeightRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerEpochRef = useRef(0);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('claw-overlay-active');
    return () => {
      root.classList.remove('claw-overlay-active');
    };
  }, []);

  useEffect(() => {
    xyneAIStreamManager.setClawOverlayOpen(isOpen || isClosing);
  }, [isOpen, isClosing]);

  useEffect(
    () => () => {
      xyneAIStreamManager.setClawOverlayOpen(false);
    },
    [],
  );

  useEffect(() => {
    xyneAIStreamManager.setHasClawOverlay(true);
    return () => xyneAIStreamManager.setHasClawOverlay(false);
  }, []);

  useEffect(() => {
    bridge.setIgnoreMouse(true);
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        bridge.setExpanded(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [bridge]);

  const cancelResize = useCallback(() => {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    pendingHeightRef.current = null;
    setIsResizing(false);
    bridge.setPanelHeight(panelHeightRef.current);
  }, [bridge]);

  useEffect(
    () =>
      bridge.onVisibility(visible => {
        if (!visible) {
          cancelResize();
          bridge.setExpanded(false);
          setIsOpen(false);
        }
      }),
    [bridge, cancelResize],
  );

  useEffect(() => {
    if (!isResizing) return;
    const endResize = (): void => cancelResize();
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    return () => {
      window.removeEventListener('pointerup', endResize);
      window.removeEventListener('pointercancel', endResize);
    };
  }, [isResizing, cancelResize]);

  useEffect(
    () =>
      bridge.onPanelHeight(height => {
        if (isResizingRef.current) return;
        setPanelHeight(clampPanelHeight(height));
      }),
    [bridge],
  );

  useEffect(
    () => () => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
    },
    [],
  );

  const handleOpen = useCallback(() => {
    isOpenRef.current = true;
    setIsClosing(false);
    bridge.setExpanded(true);

    bridge.focus();
    setIsOpen(true);
  }, [bridge]);

  const handleClose = useCallback(() => {
    cancelResize();
    isOpenRef.current = false;
    setIsClosing(true);
    setIsOpen(false);
    if (reduceMotion) bridge.setExpanded(false);
  }, [bridge, reduceMotion, cancelResize]);

  const handlePointerEnter = useCallback(() => {
    pointerEpochRef.current += 1;
    bridge.setIgnoreMouse(false);
  }, [bridge]);

  const handlePointerLeave = useCallback(() => {
    if (isResizingRef.current) return;
    pointerEpochRef.current += 1;
    bridge.setIgnoreMouse(true);
  }, [bridge]);

  const reconcilePassthrough = useCallback(() => {
    if (isResizingRef.current) return;
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const epoch = pointerEpochRef.current;
    void bridge
      .reconcile({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      .then(inside => {
        if (inside === null || isResizingRef.current) return;
        if (pointerEpochRef.current !== epoch) return;
        bridge.setIgnoreMouse(!inside);
      });
  }, [bridge]);

  const flushPanelHeight = useCallback(() => {
    resizeRafRef.current = null;
    if (pendingHeightRef.current === null) return;
    bridge.setPanelHeight(pendingHeightRef.current);
    pendingHeightRef.current = null;
  }, [bridge]);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isOpenRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStartRef.current = { screenY: event.screenY, height: panelHeightRef.current };
      setIsResizing(true);
      bridge.setIgnoreMouse(false);
    },
    [bridge],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const next = clampPanelHeight(start.height + (start.screenY - event.screenY));
      setPanelHeight(next);
      pendingHeightRef.current = next;
      if (resizeRafRef.current === null) {
        resizeRafRef.current = requestAnimationFrame(flushPanelHeight);
      }
    },
    [flushPanelHeight],
  );

  const handleResizePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizeStartRef.current) return;
      resizeStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      setIsResizing(false);
      bridge.setPanelHeight(panelHeightRef.current);
    },
    [bridge],
  );

  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      if (isExternalHttpHref(href)) {
        window.electronAPI?.openExternal?.(href);
        return;
      }

      if (href.startsWith('/')) bridge.openInMain(href);
    },
    [bridge],
  );

  const dims = isOpen
    ? { width: PANEL.width, height: panelHeight }
    : isThinking
      ? PILL_THINKING
      : PILL;
  const layoutTransition: Transition = reduceMotion
    ? { duration: 0 }
    : isResizing
      ? { duration: 0 }
      : isOpen
        ? OPEN_SPRING
        : CLOSE_SPRING;

  const panelContentVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduceMotion
        ? { duration: 0 }
        : { duration: 0.22, ease: [0, 0, 0.2, 1], delayChildren: 0.06, staggerChildren: 0.03 },
    },
    exit: {
      opacity: 0,
      y: 4,
      transition: reduceMotion ? { duration: 0 } : { duration: 0.1, ease: [0.4, 0, 1, 1] },
    },
  };

  const pillGestureProps = isOpen
    ? {}
    : {
        whileHover: { scale: reduceMotion ? 1 : 1.02 },

        whileTap: { scale: reduceMotion ? 1 : 0.96 },
      };

  return (
    <MotionConfig reducedMotion='user'>
      <ClawConversationProvider isOpen={isOpen}>
        <ClawThinkingProbe onChange={setIsThinking} />
        <div className='pointer-events-none fixed inset-0 flex items-end justify-end pl-8 pt-8'>
          <ClawPeekBubble isOpen={isOpen} />
          <motion.div
            ref={shellRef}
            layout
            onLayoutAnimationComplete={() => {
              if (!isOpenRef.current) {
                bridge.setExpanded(false);
                setIsClosing(false);
              }
              reconcilePassthrough();
            }}
            onClickCapture={handleClickCapture}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            transition={layoutTransition}
            transformTemplate={(_, generatedTransform) => `${generatedTransform} translateZ(0)`}
            {...pillGestureProps}
            style={{
              width: dims.width,
              height: dims.height,
              ...CORNER_RADII,

              originX: 1,
              originY: 1,

              willChange: 'transform',
            }}
            className={cn('claw-shell pointer-events-auto relative', isOpen && 'claw-shell--open')}
            data-popover-portal-container
            data-slot='claw-overlay'
            data-testid='claw-overlay'
          >
            {isOpen && (
              <div
                role='separator'
                aria-orientation='horizontal'
                aria-label='Resize Claw'
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                data-track-category='CLAW_OVERLAY'
                data-track-name='RESIZE_PANEL'
                className='absolute inset-x-0 top-0 z-30 h-2 cursor-ns-resize'
                style={{ touchAction: 'none' }}
              />
            )}
            <div
              className={cn(
                'flex h-full w-full flex-col overflow-hidden rounded-[inherit]',
                'bg-popover text-popover-foreground',
                'shadow-[inset_0_0_0_1px_hsl(var(--border)/0.7)]',
              )}
            >
              <ClawPill isOpen={isOpen} onOpen={handleOpen} onClose={handleClose} />
              <AnimatePresence mode='popLayout'>
                {isOpen && (
                  <motion.div
                    key='claw-panel-content'
                    variants={panelContentVariants}
                    initial='hidden'
                    animate='show'
                    exit='exit'
                    className='flex min-h-0 flex-1 flex-col'
                  >
                    <ClawChat onRequestClose={handleClose} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </ClawConversationProvider>
    </MotionConfig>
  );
}
