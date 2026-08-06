import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
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
import { cn } from '../../utils/classNames';
import { useAuth } from '../../hooks/useAuth';
import { ClawAdminAccessContext, useClawAdminAccessQuery } from '../../hooks/useClawAdminAccess';

interface AIShellProps {
  activeSessionId?: string | undefined;
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onAccount?: (() => void) | undefined;
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
  mainRef?: RefObject<HTMLDivElement | null> | undefined;
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
  const { user } = useAuth();
  const adminAccess = useClawAdminAccessQuery(user?.id);

  useSidebarResizeShortcut({
    panelRef: sidebarPanelRef,
    minWidth: CHAT_SIDEBAR_MIN_WIDTH,
    maxWidth: CHAT_SIDEBAR_MAX_WIDTH,
  });

  return (
    <ClawAdminAccessContext.Provider value={adminAccess}>
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
            className={cn('relative flex h-full min-w-0 flex-1 flex-col', mainClassName)}
          >
            {children}
          </div>
        </Panel>
      </ResizableGroup>
    </ClawAdminAccessContext.Provider>
  );
}
