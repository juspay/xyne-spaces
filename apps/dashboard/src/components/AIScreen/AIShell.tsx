import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { PanelRight, X } from 'lucide-react';
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

const WORKSPACE_PANE_SIZE_KEY = 'xyne:ai-workspace-pane-size';
const LEGACY_CHAT_PANE_SIZE_KEY = 'xyne:ai-chat-pane-size';
const LEGACY_APP_PANE_SIZE_KEY = 'xyne:ai-app-pane-size';
const WORKSPACE_PANE_MIN = 20;
const WORKSPACE_PANE_MAX = 70;
const WORKSPACE_PANE_DEFAULT = 45;

/**
 * How long the app pane takes to slide open or shut, and the CSS that does it.
 *
 * The library writes `flexGrow` inline on each `[data-panel]` element, so a
 * transition on that property animates any layout change the group makes —
 * including the neighbouring chat panel shrinking to make room, which is what
 * sells the motion. `className` on `Panel` lands on an INNER div, not the flex
 * item, so this has to be a scoped rule rather than a utility class.
 *
 * Applied only while opening or closing. Left on permanently it would also
 * smear separator drags, turning a direct manipulation into something that
 * lags the pointer by a quarter second.
 */
const PANE_ANIMATION_MS = 260;
const PANE_ANIMATION_CSS = `
.ai-shell-animating [data-panel] {
  transition: flex-grow ${PANE_ANIMATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .ai-shell-animating [data-panel] { transition: none; }
}
`;

const NARROW_VIEWPORT_QUERY = '(max-width: 1100px)';

function clampWorkspacePaneSize(n: number): number {
  return Math.min(WORKSPACE_PANE_MAX, Math.max(WORKSPACE_PANE_MIN, n));
}

function migrateLegacyPaneSize(): void {
  if (localStorage.getItem(WORKSPACE_PANE_SIZE_KEY) !== null) return;
  const legacyChat = localStorage.getItem(LEGACY_CHAT_PANE_SIZE_KEY);
  if (legacyChat !== null) {
    const n = Number(legacyChat);
    localStorage.removeItem(LEGACY_CHAT_PANE_SIZE_KEY);
    localStorage.removeItem(LEGACY_APP_PANE_SIZE_KEY);
    if (!Number.isFinite(n)) return;
    const migrated = clampWorkspacePaneSize(100 - n);
    localStorage.setItem(WORKSPACE_PANE_SIZE_KEY, String(Math.round(migrated * 10) / 10));
    return;
  }
  const legacyApp = localStorage.getItem(LEGACY_APP_PANE_SIZE_KEY);
  if (legacyApp === null) return;
  const n = Number(legacyApp);
  localStorage.removeItem(LEGACY_APP_PANE_SIZE_KEY);
  if (!Number.isFinite(n)) return;
  const migrated = clampWorkspacePaneSize(n);
  localStorage.setItem(WORKSPACE_PANE_SIZE_KEY, String(Math.round(migrated * 10) / 10));
}

function workspacePaneSize(): number {
  migrateLegacyPaneSize();
  const raw = localStorage.getItem(WORKSPACE_PANE_SIZE_KEY);
  const n = raw ? Number(raw) : NaN;
  // Clamp to the Panel's own bounds so a corrupted value cannot wedge the
  // layout; NaN falls through to the original default.
  if (!Number.isFinite(n) || n < WORKSPACE_PANE_MIN || n > WORKSPACE_PANE_MAX)
    return WORKSPACE_PANE_DEFAULT;
  return n;
}

function saveWorkspacePaneSize(asPercentage: number): void {
  // 0 means the panel is unmounting/collapsed, not a chosen width.
  if (asPercentage < WORKSPACE_PANE_MIN || asPercentage > WORKSPACE_PANE_MAX) return;
  localStorage.setItem(WORKSPACE_PANE_SIZE_KEY, String(Math.round(asPercentage * 10) / 10));
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const onChange = (): void => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function setWorkspaceCollapsed(panel: PanelImperativeHandle | null, collapsed: boolean): void {
  if (!panel) return;
  try {
    if (collapsed && !panel.isCollapsed()) panel.collapse();
    else if (!collapsed && panel.isCollapsed()) panel.expand();
  } catch {
    return;
  }
}

export interface WorkspacePanelControls {
  expand: () => void;
  collapse: () => void;
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
  workspacePanel?: ReactNode | undefined;
  workspaceOpen?: boolean | undefined;
  onExpandWorkspace?: (() => void) | undefined;
  onCloseWorkspace?: (() => void) | undefined;
  workspaceControlsRef?: React.MutableRefObject<WorkspacePanelControls | null> | undefined;
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
  workspacePanel,
  workspaceOpen,
  onExpandWorkspace,
  onCloseWorkspace,
  workspaceControlsRef,
  collapseSignal,
  onSidebarCollapsedChange,
  sidebarToggleRef,
  children,
}: AIShellProps): ReactElement {
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const workspacePanelRef = useRef<PanelImperativeHandle>(null);
  const narrow = useNarrowViewport();
  const hasWorkspace = workspacePanel !== undefined && workspacePanel !== null;
  const workspaceEnabled = hasWorkspace && workspaceOpen !== false;
  const splitMode = workspaceEnabled && !narrow;
  const overlayMode = workspaceEnabled && narrow;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The pane outlives `splitMode` by one animation so it has something to
  // shrink: unmounting on the same commit is exactly the abrupt disappearance
  // this replaces. `animating` gates the transition CSS so it is on for the
  // toggle and off for everything else — notably separator drags.
  const [paneMounted, setPaneMounted] = useState(splitMode);
  const [animating, setAnimating] = useState(false);
  // The last non-null pane, so the closing animation still has something to
  // draw after the caller has stopped passing one.
  const lastPaneRef = useRef<ReactNode>(null);
  if (workspacePanel) lastPaneRef.current = workspacePanel;

  useEffect(() => {
    if (splitMode) {
      setPaneMounted(true);
      return;
    }
    if (!paneMounted) return;
    setAnimating(true);
    workspacePanelRef.current?.collapse();
    const done = setTimeout(() => {
      setPaneMounted(false);
      setAnimating(false);
    }, PANE_ANIMATION_MS);
    return () => clearTimeout(done);
  }, [splitMode, paneMounted]);

  // Opening: the Panel mounts collapsed, then grows to the saved width on the
  // next frame. Two frames, not one — the browser needs to paint the zero-width
  // state before a change to it can be interpolated from anywhere.
  useEffect(() => {
    if (!paneMounted || !splitMode) return;
    setAnimating(true);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        workspacePanelRef.current?.resize(`${workspacePaneSize()}%`),
      );
    });
    const done = setTimeout(() => setAnimating(false), PANE_ANIMATION_MS + 40);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      clearTimeout(done);
    };
  }, [paneMounted, splitMode]);

  useEffect(() => {
    if (!overlayMode && drawerOpen) setDrawerOpen(false);
  }, [overlayMode, drawerOpen]);

  useEffect(() => {
    if (!overlayMode || !drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlayMode, drawerOpen]);

  useEffect(() => {
    if (!workspaceControlsRef) return;
    workspaceControlsRef.current = {
      expand: () => {
        if (overlayMode) {
          setDrawerOpen(true);
          return;
        }
        setWorkspaceCollapsed(workspacePanelRef.current, false);
      },
      collapse: () => {
        if (overlayMode) {
          setDrawerOpen(false);
          return;
        }
        setWorkspaceCollapsed(workspacePanelRef.current, true);
      },
    };
    return () => {
      workspaceControlsRef.current = null;
    };
  }, [workspaceControlsRef, overlayMode]);

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
      paneMounted
        ? ['ai-sidebar-panel', 'ai-chat', 'ai-workspace']
        : ['ai-sidebar-panel', 'ai-chat'],
    [paneMounted],
  );

  useSidebarResizeShortcut({
    panelRef: sidebarPanelRef,
    minWidth: CHAT_SIDEBAR_MIN_WIDTH,
    maxWidth: CHAT_SIDEBAR_MAX_WIDTH,
  });

  return (
    <ResizableGroup
      orientation='horizontal'
      className={cn('flex h-full align-top', animating && 'ai-shell-animating')}
      autoSaveId='ai-screen-resize'
      panelIds={panelIds}
    >
      <style>{PANE_ANIMATION_CSS}</style>
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

      <Panel id='ai-chat' minSize='30%'>
        <div
          ref={mainRef}
          className={cn(
            'relative flex h-full min-w-0 flex-1 flex-col overflow-hidden',
            // In the split view the chat's right edge butts against the
            // workspace, so rounding it would cut a notch out of the seam
            // between them. Round only the outer side; square where they meet.
            paneMounted ? 'rounded-l-2xl' : 'rounded-2xl',
            mainClassName ?? 'bg-background',
          )}
        >
          {children}
          {hasWorkspace && !workspaceEnabled && onExpandWorkspace && (
            <button
              type='button'
              onClick={onExpandWorkspace}
              aria-label='Open workspace'
              title='Open workspace'
              className='absolute right-3 top-3 z-30 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-secondary/60 hover:text-foreground'
              data-track-category='AskAI'
              data-track-name='workspace-open'
            >
              <PanelRight className='h-3.5 w-3.5' />
              Workspace
            </button>
          )}
          {overlayMode && drawerOpen && (
            <div
              role='dialog'
              aria-modal='false'
              aria-label='Workspace'
              className='absolute inset-y-0 right-0 z-50 flex w-full max-w-[min(100%,28rem)] flex-col border-l border-border bg-background shadow-2xl'
            >
              <button
                type='button'
                onClick={() => {
                  setDrawerOpen(false);
                  onCloseWorkspace?.();
                }}
                aria-label='Close workspace'
                title='Close workspace'
                className='absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                data-track-category='AskAI'
                data-track-name='workspace-drawer-close'
              >
                <X className='h-4 w-4' />
              </button>
              <div className='flex h-full min-h-0 flex-1 flex-col'>{workspacePanel}</div>
            </div>
          )}
        </div>
      </Panel>
      {paneMounted && (
        <>
          <Separator className='group flex w-[2px] cursor-col-resize items-center justify-center transition-colors'>
            <div className='h-full w-[2px] bg-transparent group-hover:bg-primary group-active:bg-primary' />
          </Separator>
          <Panel
            id='ai-workspace'
            panelRef={workspacePanelRef}
            // Mounts at zero and grows on the next frame — that IS the open
            // animation. `collapsible` is what lets it sit below `minSize`.
            defaultSize='0%'
            collapsible
            collapsedSize='0%'
            minSize='20%'
            // The group's saved layout is only restored at GROUP mount, and the
            // workspace mounts and unmounts while the group stays up — so without
            // our own persistence every re-entry (and every thread switch) snapped
            // the workspace back to the default width. One slot, not per-thread: the
            // workspace's width is a workspace habit, not a property of a conversation.
            onResize={(size: PanelSize) => {
              if (paneMounted && !animating) saveWorkspacePaneSize(size.asPercentage);
            }}
          >
            <div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-r-2xl'>
              {/* Kept through the closing animation so the pane shrinks with
                  its contents rather than emptying first. */}
              {workspacePanel ?? lastPaneRef.current}
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}
