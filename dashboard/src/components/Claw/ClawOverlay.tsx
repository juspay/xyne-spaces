import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'framer-motion';
import { cn } from '../../utils/classNames';
import { CORNER_RADII, PANEL, PILL } from './claw.constants';
import { isExternalHttpHref } from './claw.utils';
import { CLOSE_SPRING, OPEN_SPRING } from './claw.motion';
import { useClawOverlayBridge } from './useClawOverlayBridge';
import { ClawConversationProvider } from './ClawConversationContext';
import { ClawPill } from './ClawPill';
import { ClawChat } from './ClawChat/ClawChat';
import { xyneAIStreamManager } from '../../services/XyneAI';
import './claw.css';

export function ClawOverlay(): React.ReactElement {
  const bridge = useClawOverlayBridge();
  const reduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const blurFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('claw-overlay-active');
    return () => {
      root.classList.remove('claw-overlay-active');
    };
  }, []);

  useEffect(
    () => () => {
      if (blurFrameRef.current !== null) cancelAnimationFrame(blurFrameRef.current);
    },
    [],
  );

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
    bridge.setExpanded(false);
    bridge.setIgnoreMouse(true);
  }, [bridge]);

  useEffect(
    () =>
      bridge.onVisibility(visible => {
        if (!visible) {
          bridge.setExpanded(false);
          setIsOpen(false);
        }
      }),
    [bridge],
  );

  const handleOpen = useCallback(() => {
    if (blurFrameRef.current !== null) {
      cancelAnimationFrame(blurFrameRef.current);
      blurFrameRef.current = null;
    }
    isOpenRef.current = true;
    setIsClosing(false);
    bridge.setExpanded(true);

    bridge.focus();
    setIsOpen(true);
  }, [bridge]);

  const handleClose = useCallback(() => {
    isOpenRef.current = false;
    setIsClosing(true);
    setIsOpen(false);
    if (reduceMotion) bridge.setExpanded(false);

    if (blurFrameRef.current !== null) cancelAnimationFrame(blurFrameRef.current);
    blurFrameRef.current = requestAnimationFrame(() => {
      blurFrameRef.current = null;
      if (!isOpenRef.current) bridge.blur();
    });
  }, [bridge, reduceMotion]);

  const handlePointerEnter = useCallback(() => {
    bridge.setIgnoreMouse(false);
  }, [bridge]);

  const handlePointerLeave = useCallback(() => {
    bridge.setIgnoreMouse(true);
  }, [bridge]);

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

  const dims = isOpen ? PANEL : PILL;
  const layoutTransition: Transition = reduceMotion
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
        <div className='pointer-events-none fixed inset-0 flex items-end justify-end pl-8 pt-8'>
          <motion.div
            layout
            onLayoutAnimationComplete={() => {
              if (!isOpenRef.current) {
                bridge.setExpanded(false);
                setIsClosing(false);
              }
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
            data-slot='claw-overlay'
            data-testid='claw-overlay'
          >
            <div
              className={cn(
                'flex h-full w-full flex-col overflow-hidden rounded-[inherit]',
                'bg-popover/80 text-popover-foreground dark:bg-popover/70',
                'shadow-[inset_0_0_0_1px_hsl(var(--border)/0.7)]',
              )}
            >
              <ClawPill isOpen={isOpen || isClosing} onOpen={handleOpen} onClose={handleClose} />
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
