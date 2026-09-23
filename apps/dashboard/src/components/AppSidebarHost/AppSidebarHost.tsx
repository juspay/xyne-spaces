import { useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../ui/Resizable/Resizable';

export interface SidebarPanelDescriptor {
  id: string;
  isActive: boolean;
  size: { default: number; min: number; max: number };
  content: ReactNode;
  /** For panels a sibling module needs to resize imperatively. */
  panelRef?: RefObject<PanelImperativeHandle | null>;
}

interface AppSidebarHostProps {
  /** Ordered by precedence — the first entry with `isActive: true` wins. */
  panels: SidebarPanelDescriptor[];
  children: ReactNode;
  /** Rendered instead of the slot layout when no panel is active and `forceRender` is false. */
  fallback: ReactNode;
  /** Render the slot layout even with no active panel (e.g. an embedded webview is idle/closed). */
  forceRender?: boolean;
  mainPanelRef?: RefObject<PanelImperativeHandle | null>;
}

export const AppSidebarHost = ({
  panels,
  children,
  fallback,
  forceRender = false,
  mainPanelRef,
}: AppSidebarHostProps): ReactElement => {
  const activePanel = panels.find(panel => panel.isActive) ?? null;
  const slotPanelId = activePanel ? `app-root-slot-${activePanel.id}` : null;
  const slotPanelRef = useRef<PanelImperativeHandle>(null);
  const forwardedPanelRef = useRef<RefObject<PanelImperativeHandle | null> | null>(null);

  // When the active panel changes, we need to update the forwarded ref to point to the new panel's ref, and clear the old one.
  useLayoutEffect(() => {
    if (forwardedPanelRef.current && forwardedPanelRef.current !== activePanel?.panelRef) {
      forwardedPanelRef.current.current = null;
    }
    forwardedPanelRef.current = activePanel?.panelRef ?? null;
    if (activePanel?.panelRef) {
      activePanel.panelRef.current = slotPanelRef.current;
    }
  }, [activePanel]);

  const shouldRenderSlot = activePanel !== null || forceRender;
  if (!shouldRenderSlot) return <>{fallback}</>;

  return (
    <div className='flex flex-col h-screen'>
      <ResizableGroup
        orientation='horizontal'
        className='flex-1 no-scrollbar overflow-auto'
        autoSaveId='app-root-browser'
        panelIds={slotPanelId ? ['app-root-left', slotPanelId] : ['app-root-left']}
      >
        <Panel
          id='app-root-left'
          panelRef={mainPanelRef}
          defaultSize={activePanel ? undefined : '100%'}
        >
          {children}
        </Panel>
        {activePanel && slotPanelId && (
          <>
            <Separator className='w-1 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div className='w-0.5 h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary transition-colors duration-200 rounded-full'></div>
            </Separator>
            <Panel
              id={slotPanelId}
              panelRef={slotPanelRef}
              defaultSize={`${activePanel.size.default}%`}
              minSize={`${activePanel.size.min}%`}
              maxSize={`${activePanel.size.max}%`}
            >
              {activePanel.content}
            </Panel>
          </>
        )}
      </ResizableGroup>
    </div>
  );
};
