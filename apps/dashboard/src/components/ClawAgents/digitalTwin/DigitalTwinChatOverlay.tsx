import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import XyneAISidebar from '@/components/Chat/XyneAISidebar/XyneAISidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, MaximizeTwoArrow, X } from '@/components/ClawAgents/digitalTwin/icons';
import type { ComposerContext } from '@/components/AIScreen/composerContext';
import { useV2SessionInvalidator, useV2SessionsList } from '@/hooks/useAskAISessionsV2';
import { cn } from '@/utils/classNames';
import { DIGITAL_TWIN_EASE_OUT, DIGITAL_TWIN_MOTION } from './motion';

const TWIN_AGENT_SLUG = 'digital-twin';
const OVERLAY_HEIGHT = 540;
const OVERLAY_MAX_WIDTH = 689;
const OVERLAY_HEADER = 36;
const COMPACT_RADIUS = 20;
const EXPANDED_RADIUS = 20;
const IDLE_WIDTH = 500;
const DOCK_BOTTOM_PX = 24;
const ICON_BUTTON =
  'dt-pressable inline-flex size-6 items-center justify-center rounded-md p-1 text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground';

const findScrollPort = (start: HTMLElement | null): HTMLElement | null => {
  let parent = start?.parentElement ?? null;
  while (parent) {
    const { overflowY } = window.getComputedStyle(parent);
    if (/^(auto|scroll|overlay)$/.test(overflowY)) return parent;
    parent = parent.parentElement;
  }
  return null;
};

const isInsideChatOverlay = (target: EventTarget | null, host: HTMLElement | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (host?.contains(target)) return true;
  return Boolean(
    target.closest(
      '[data-radix-popper-content-wrapper], [data-radix-dropdown-menu-content], [data-radix-menu-content], [data-radix-dialog-content], [data-radix-dialog-overlay], [role="dialog"], .dt-menu-content, .dt-filter-menu-content, .dt-composer-plus-menu',
    ),
  );
};

const isComposerActionControl = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, [role="button"], [data-radix-dropdown-menu-trigger], [data-radix-dropdown-menu-content], .dt-composer-plus-menu',
    ),
  );
};

export const DigitalTwinChatOverlay = ({
  variant = 'origin',
  open,
  sessionActive,
  docked,
  dockRect,
  reduceMotion,
  conversationId,
  sessionKey,
  startFresh,
  pendingQuery,
  titleHint,
  autoSendNonce,
  extras,
  onConversationChange,
  onSelectConversation,
  onMaximize,
  onCollapse,
  onExpand,
  onClose,
  onExited,
  children,
}: {
  variant?: 'origin' | 'session';
  open: boolean;
  sessionActive: boolean;
  docked: boolean;
  dockRect: { left: number; width: number };
  reduceMotion: boolean | null;
  conversationId: string;
  sessionKey: string;
  startFresh: boolean;
  pendingQuery: string;
  titleHint: string;
  autoSendNonce: number;
  extras: ComposerContext;
  onConversationChange: (id: string) => void;
  onSelectConversation: (id: string | null) => void;
  onMaximize: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
  onExited?: () => void;
  children: ReactNode;
}): ReactElement => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const exitedRef = useRef(false);
  const [composerHeight, setComposerHeight] = useState(36);
  const [fittedHeight, setFittedHeight] = useState(OVERLAY_HEIGHT);
  const [dockSlideOpen, setDockSlideOpen] = useState(false);
  const closing = variant === 'session' && !sessionActive;
  const showSessionChrome = variant === 'session';
  const sessions = useV2SessionsList(TWIN_AGENT_SLUG, sessionActive || closing);
  const { invalidateSessions } = useV2SessionInvalidator();
  const duration = reduceMotion === true ? 0 : DIGITAL_TWIN_MOTION.entrance;
  const outOfFlow = showSessionChrome || docked;
  const restWidth = dockRect.width > 0 ? dockRect.width : IDLE_WIDTH;
  const underlayHeight = closing
    ? 0
    : !showSessionChrome
      ? 0
      : open
        ? Math.max(OVERLAY_HEADER, fittedHeight - composerHeight)
        : OVERLAY_HEADER;
  const frameWidth = open && !closing ? OVERLAY_MAX_WIDTH : restWidth;
  const frameRadius =
    open && !closing ? EXPANDED_RADIUS : showSessionChrome ? COMPACT_RADIUS : EXPANDED_RADIUS;
  const sessionCard = showSessionChrome && !closing;
  const overlayTween = {
    type: 'tween' as const,
    duration,
    ease: DIGITAL_TWIN_EASE_OUT,
  };

  const title = useMemo(() => {
    const match = sessions.data?.find(
      conversation =>
        conversation.sessionId === conversationId || conversation.id === conversationId,
    );
    return match?.title?.trim() || titleHint.trim() || 'New chat';
  }, [conversationId, sessions.data, titleHint]);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const sync = (): void => {
      const next = Math.round(el.getBoundingClientRect().height);
      setComposerHeight(current => (current === next ? current : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [children, sessionActive, open, closing]);

  useLayoutEffect(() => {
    if (!showSessionChrome || closing) {
      setFittedHeight(OVERLAY_HEIGHT);
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    const measure = (): void => {
      const port = findScrollPort(host);
      const portRect = (port ?? document.documentElement).getBoundingClientRect();
      const available = docked
        ? Math.round(
            (window.visualViewport?.height ?? window.innerHeight) - DOCK_BOTTOM_PX - portRect.top,
          )
        : Math.round(host.getBoundingClientRect().bottom - portRect.top);
      const minChrome = composerHeight + OVERLAY_HEADER;
      const next = Math.min(OVERLAY_HEIGHT, Math.max(minChrome, available));
      setFittedHeight(current => (current === next ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return (): void => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [showSessionChrome, closing, docked, composerHeight]);

  useLayoutEffect(() => {
    if (!docked) {
      setDockSlideOpen(false);
      return;
    }
    if (variant === 'session') {
      setDockSlideOpen(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setDockSlideOpen(true));
    return (): void => window.cancelAnimationFrame(frame);
  }, [docked, variant]);

  useEffect(() => {
    if (!conversationId) return;
    invalidateSessions(TWIN_AGENT_SLUG);
  }, [conversationId, invalidateSessions]);

  useEffect(() => {
    if (!sessionActive) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (open) onCollapse();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [sessionActive, open, onCollapse, onClose]);

  useEffect(() => {
    if (!open || closing) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (isInsideChatOverlay(event.target, hostRef.current)) return;
      onCollapse();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return (): void => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, closing, onCollapse]);

  useEffect(() => {
    if (!closing) exitedRef.current = false;
  }, [closing]);

  const handleHistoryKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') event.stopPropagation();
  };

  const expandFromComposer = (target: EventTarget | null): void => {
    if (!sessionActive || open || closing || isComposerActionControl(target)) return;
    onExpand();
  };

  const handleFrameAnimationComplete = (): void => {
    if (!closing || exitedRef.current) return;
    exitedRef.current = true;
    onExited?.();
  };

  return (
    <div
      ref={hostRef}
      className='dt-chat-overlay-host'
      style={
        {
          height: 0,
          ...(docked ? { '--dt-ask-dock-center': `${dockRect.left + dockRect.width / 2}px` } : {}),
        } as CSSProperties
      }
    >
      <motion.div
        initial={
          variant === 'session' && reduceMotion !== true
            ? {
                width: restWidth,
                maxWidth: restWidth,
                borderRadius: COMPACT_RADIUS,
              }
            : false
        }
        animate={{
          width: frameWidth,
          maxWidth: frameWidth,
          borderRadius: frameRadius,
        }}
        transition={overlayTween}
        style={{ overflow: 'visible' }}
        className={cn(
          'dt-chat-overlay-frame flex w-full flex-col justify-end overflow-visible',
          !outOfFlow && 'relative',
          sessionCard ? 'bg-background' : 'bg-transparent',
          outOfFlow && 'dt-chat-overlay-panel',
          sessionCard && 'dt-chat-overlay dt-has-underlay',
          docked && 'is-docked',
          docked && variant !== 'session' && 't-panel-slide',
        )}
        data-open={dockSlideOpen ? 'true' : 'false'}
      >
        {showSessionChrome && (
          <motion.div
            className='dt-chat-overlay-clip dt-chat-overlay-underlay relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden'
            initial={reduceMotion === true ? false : { height: 0 }}
            animate={{ height: underlayHeight }}
            transition={overlayTween}
            onAnimationComplete={handleFrameAnimationComplete}
          >
            <motion.div
              className='overflow-hidden'
              initial={reduceMotion === true ? false : { height: 0, opacity: 0 }}
              animate={{
                height: closing ? 0 : OVERLAY_HEADER,
                opacity: closing ? 0 : 1,
              }}
              transition={overlayTween}
            >
              <header
                className={cn(
                  'flex h-9 w-full shrink-0 items-center justify-between py-1.5 pl-3 pr-1.5',
                  open && !closing && 'border-b-[0.5px] border-border',
                )}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      onKeyDown={handleHistoryKeyDown}
                      className='dt-pressable flex h-5 max-w-[min(100%,280px)] items-center gap-0.5 rounded-md py-0.5 pl-1 pr-0.5 text-[13px] font-[450] leading-[1.2] tracking-[-0.1px] text-foreground'
                      aria-label='Chat history'
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin chat history'
                    >
                      <span className='min-w-0 truncate'>{title}</span>
                      <ChevronDown className='dt-details-chevron size-4 shrink-0 text-foreground/50' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='start'
                    className='dt-menu-content max-h-80 w-64 overflow-y-auto'
                  >
                    <DropdownMenuItem
                      className='text-[13px] font-[450]'
                      onSelect={(): void => onSelectConversation(null)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin new overlay chat'
                    >
                      New chat
                    </DropdownMenuItem>
                    {(sessions.data?.length ?? 0) > 0 && <DropdownMenuSeparator />}
                    {sessions.data?.map(conversation => (
                      <DropdownMenuItem
                        key={conversation.sessionId}
                        className='text-[13px] font-[450]'
                        onSelect={(): void => onSelectConversation(conversation.sessionId)}
                        data-track-category='Claw Agents'
                        data-track-name='Digital Twin load overlay chat'
                      >
                        <span className='min-w-0 truncate'>
                          {conversation.title?.trim() || 'New chat'}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className='flex items-center'>
                  <button
                    type='button'
                    className={ICON_BUTTON}
                    aria-label='Open in side panel'
                    title='Open in side panel'
                    onClick={onMaximize}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin expand chat to side panel'
                  >
                    <MaximizeTwoArrow className='size-4' />
                  </button>
                  <button
                    type='button'
                    className={ICON_BUTTON}
                    aria-label='Close chat'
                    title='Close chat'
                    onClick={onClose}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin close chat overlay'
                  >
                    <X className='size-4' />
                  </button>
                </div>
              </header>
            </motion.div>
            <div
              className={cn(
                'min-h-0 flex-1 overflow-hidden',
                (!open || closing) && 'pointer-events-none',
              )}
              aria-hidden={!open || closing}
              inert={!open || closing}
            >
              <XyneAISidebar
                key={sessionKey}
                channelId={null}
                startFreshChat={startFresh}
                forcedAgentSlug={TWIN_AGENT_SLUG}
                hideHeader
                hideComposer
                embedded
                initialQuery={pendingQuery}
                autoSendNonce={autoSendNonce}
                seedComposerContext={extras}
                onConversationChange={onConversationChange}
                {...(startFresh || !conversationId
                  ? {}
                  : { initialConversationId: conversationId })}
              />
            </div>
          </motion.div>
        )}
        <div
          ref={composerRef}
          className={cn(
            'relative z-10 mt-auto shrink-0 overflow-visible',
            showSessionChrome && 'px-0.5 pb-0.5',
          )}
          onPointerDown={(event): void => expandFromComposer(event.target)}
          onFocusCapture={(event): void => {
            if (event.target instanceof HTMLTextAreaElement) expandFromComposer(event.target);
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
};
