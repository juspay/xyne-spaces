import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
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
  children,
}: AIShellProps): ReactElement {
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);

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
    >
      <Panel
        id='ai-sidebar-panel'
        panelRef={sidebarPanelRef}
        defaultSize={CHAT_SIDEBAR_DEFAULT_WIDTH}
        minSize={CHAT_SIDEBAR_MIN_WIDTH}
        maxSize={CHAT_SIDEBAR_MAX_WIDTH}
        groupResizeBehavior='preserve-pixel-size'
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
    </ResizableGroup>
  );
}
