import { useEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
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
  const slotPanelRef = useRef<PanelImperativeHandle>(null);

  // Forward the shared slot ref to a panel that requested its own handle.
  useEffect(() => {
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
        panelIds={activePanel ? ['app-root-left', 'app-root-slot'] : ['app-root-left']}
      >
        <Panel
          id='app-root-left'
          panelRef={mainPanelRef}
          defaultSize={activePanel ? undefined : '100%'}
        >
          {children}
        </Panel>
        {activePanel && (
          <>
            <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
              <div
                id='panel-resize-divider'
                className='w-[2px] h-full bg-transparent group-hover:bg-primary group-active:bg-primary'
              ></div>
            </Separator>
            <Panel
              id='app-root-slot'
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
