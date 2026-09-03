import {
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '../../utils/classNames';
import { AISidebar } from './AISidebar';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
  type PanelSize,
} from '../ui/Resizable/Resizable';
import { useSidebarResizeShortcut } from '../../hooks/useSidebarResizeShortcut';
import {
  CHAT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_SIDEBAR_MAX_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
} from '../../routes/ChatScreen/chatSidebarWidth';

const APP_PANE_SIZE_KEY = 'xyne:ai-app-pane-size';

/** Last user-chosen pane width as a percentage string Panel accepts ("55%"). */
function appPaneDefaultSize(): string {
  const raw = localStorage.getItem(APP_PANE_SIZE_KEY);
  const n = raw ? Number(raw) : NaN;
  // Clamp to the Panel's own bounds so a corrupted value cannot wedge the
  // layout; NaN falls through to the original default.
  if (!Number.isFinite(n) || n < 30 || n > 90) return '55%';
  return `${n}%`;
}

function saveAppPaneSize(asPercentage: number): void {
  // 0 means the panel is unmounting/collapsed, not a chosen width.
  if (asPercentage < 30 || asPercentage > 90) return;
  localStorage.setItem(APP_PANE_SIZE_KEY, String(Math.round(asPercentage * 10) / 10));
}

interface AIShellProps {
  activeSessionId?: string | undefined;
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onAccount?: (() => void) | undefined;
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
  mainRef?: RefObject<HTMLDivElement | null> | undefined;
  /** Overrides the main panel's background token (defaults to
   *  `bg-background`) — e.g. `ai-page-bg` for screens (like /ai/knowledge)
   *  that need to match a different surface elsewhere in the app. */
  mainClassName?: string | undefined;
  /**
   * App Creation mode: a third, persistent panel to the right of the chat.
   * Absent → the exact two-panel tree this shell has always rendered, which is
   * what /ai/knowledge and the Library screens rely on via AISectionLayout.
   */
  rightPanel?: ReactNode | undefined;
  /**
   * One-shot collapse EVENT: each increment collapses the sidebar once. An
   * event rather than steady state on purpose — the sidebar belongs to the
   * user, and a state prop would re-assert itself on every thread switch,
   * un-doing a sidebar they had deliberately opened. The only sender today is
   * "an app was just generated live in this chat" with the preference on.
   */
  collapseSignal?: number | undefined;
  /** Reports the sidebar's collapsed state, so a header toggle can pick its
   *  icon. Fired from the Panel's own onResize — the ground truth. */
  onSidebarCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  /** Receives a toggle function for the sidebar, for the chat header button. */
  sidebarToggleRef?: React.MutableRefObject<(() => void) | null> | undefined;
  children: ReactNode;
}

export function AIShell({
  activeSessionId,
  onCreateChat,
  onSelectSession,
  onAccount,
  mobileOpen,
  onMobileOpenChange,
  mainRef,
  mainClassName,
  rightPanel,
  collapseSignal,
  onSidebarCollapsedChange,
  sidebarToggleRef,
  children,
}: AIShellProps): ReactElement {
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const splitMode = rightPanel !== undefined && rightPanel !== null;

  // One-shot collapse on signal. Still a settle LOOP, not a single call:
  // `expand()`/`collapse()` in react-resizable-panels are no-ops unless the
  // panel is in the opposite state *at the instant of the call*, and the
  // group's re-layout when panels mount/unmount is deferred — a one-shot fired
  // in the wrong commit is clobbered a frame later (that exact bug shipped
  // once). Enforce for a few frames against the panel's real isCollapsed().
  //
  // Nothing here ever EXPANDS the sidebar. Expanding is the user's (or the
  // header toggle's) act alone, which is what keeps a deliberately-opened
  // sidebar open across thread switches and mode exits.
  const lastSignal = useRef(collapseSignal ?? 0);
  useEffect(() => {
    const signal = collapseSignal ?? 0;
    if (signal === lastSignal.current) return;
    lastSignal.current = signal;
    let attempts = 0;
    let raf = 0;
    const apply = (): void => {
      const panel = sidebarPanelRef.current;
      if (panel && panel.isCollapsed()) return; // settled
      panel?.collapse();
      attempts += 1;
      if (attempts < 10) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [collapseSignal]);

  // The header button toggles from the panel's REAL state, so it can never
  // disagree with what a drag or the collapse signal did.
  useEffect(() => {
    if (!sidebarToggleRef) return;
    sidebarToggleRef.current = () => {
      const panel = sidebarPanelRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) panel.expand();
      else panel.collapse();
    };
    return () => {
      sidebarToggleRef.current = null;
    };
  }, [sidebarToggleRef]);

  // This group's Panels are CONDITIONAL, which the persistence wrapper requires
  // panelIds for: without it the group restores whichever layout was written
  // last — a two-panel layout onto a three-panel tree — then recomputes, fires
  // onLayoutChanged, and churns. Memoized because a fresh array on every render
  // re-initializes useDefaultLayout and reproduces the same churn.
  const panelIds = useMemo(
    () =>
      splitMode ? ['ai-sidebar-panel', 'ai-main', 'ai-app-pane'] : ['ai-sidebar-panel', 'ai-main'],
    [splitMode],
  );

  useSidebarResizeShortcut({
    panelRef: sidebarPanelRef,
    minWidth: CHAT_SIDEBAR_MIN_WIDTH,
    maxWidth: CHAT_SIDEBAR_MAX_WIDTH,
  });

  return (
    <ResizableGroup
      orientation='horizontal'
      className='flex h-full align-top'
      autoSaveId='ai-screen-resize'
      panelIds={panelIds}
    >
      <Panel
        id='ai-sidebar-panel'
        panelRef={sidebarPanelRef}
        defaultSize={CHAT_SIDEBAR_DEFAULT_WIDTH}
        minSize={CHAT_SIDEBAR_MIN_WIDTH}
        maxSize={CHAT_SIDEBAR_MAX_WIDTH}
        groupResizeBehavior='preserve-pixel-size'
        collapsible
        collapsedSize={0}
        onResize={(size: PanelSize) => onSidebarCollapsedChange?.(size.inPixels === 0)}
      >
        <aside id='ai-sidebar' aria-label='AI Sidebar' className='h-full w-full'>
          <AISidebar
            activeSessionId={activeSessionId}
            onCreateChat={onCreateChat}
            onSelectSession={onSelectSession}
            onAccount={onAccount}
            mobileOpen={mobileOpen}
            onMobileOpenChange={onMobileOpenChange}
          />
        </aside>
      </Panel>

      <Separator className='group flex w-[2px] cursor-col-resize items-center justify-center transition-colors'>
        <div className='h-full w-[2px] bg-transparent group-hover:bg-primary group-active:bg-primary' />
      </Separator>

      <Panel id='ai-main' minSize='30%'>
        <div
          ref={mainRef}
          className={cn(
            'relative flex h-full min-w-0 flex-1 flex-col overflow-hidden',
            // In the split view the chat's right edge butts against the app
            // pane, so rounding it would cut a notch out of the seam between
            // them. Round only the outer side; square where they meet.
            splitMode ? 'rounded-l-2xl' : 'rounded-2xl',
            mainClassName ?? 'bg-background',
          )}
        >
          {children}
        </div>
      </Panel>

      {splitMode && (
        <>
          <Separator className='group flex w-[2px] cursor-col-resize items-center justify-center transition-colors'>
            <div className='h-full w-[2px] bg-transparent group-hover:bg-primary group-active:bg-primary' />
          </Separator>
          <Panel
            id='ai-app-pane'
            // The group's saved layout is only restored at GROUP mount, and
            // this Panel mounts and unmounts while the group stays up — so
            // without our own persistence every re-entry (and every thread
            // switch) snapped back to the default width. One slot, not
            // per-thread: the pane's width is a workspace habit, not a
            // property of a conversation.
            defaultSize={appPaneDefaultSize()}
            minSize='30%'
            onResize={(size: PanelSize) => saveAppPaneSize(size.asPercentage)}
          >
            <div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden'>
              {rightPanel}
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}
