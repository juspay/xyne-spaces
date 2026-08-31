import { useMemo, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { cn } from '../../utils/classNames';
import { AISidebar } from './AISidebar';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../ui/Resizable/Resizable';
import { useSidebarResizeShortcut } from '../../hooks/useSidebarResizeShortcut';
import {
  CHAT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_SIDEBAR_MAX_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
} from '../../routes/ChatScreen/chatSidebarWidth';

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
  children,
}: AIShellProps): ReactElement {
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const splitMode = rightPanel !== undefined && rightPanel !== null;

  // The sidebar is deliberately NOT collapsed when the split view opens.
  // Driving it imperatively meant racing the group's own deferred re-layout,
  // which produced a stuck-collapsed sidebar more than once; and auto-collapsing
  // then auto-expanding overrode whatever width the user had chosen. The Panel
  // stays `collapsible`, so collapsing is one drag away when someone wants the
  // room. Do not re-add an automatic collapse without a settle strategy.

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
            'relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl',
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
          <Panel id='ai-app-pane' defaultSize='55%' minSize='30%'>
            <div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden'>
              {rightPanel}
            </div>
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}
