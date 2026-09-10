import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout, type LayoutItem, type ResizeHandleAxis } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useComponentMutations } from '../../../hooks/useDashboards';
import ComponentTile, { type ComponentTileData } from './ComponentTile';
import type { DashboardRuntimeContext } from '../../../services/DynamicDashboard/planResolver';
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  GRID_COLS,
  MIN_TILE_H,
  MIN_TILE_W,
  ROW_HEIGHT_PX,
  TILE_MARGIN_PX,
} from './constants';

function ResizeCornerHandle(_axis: ResizeHandleAxis, ref: React.Ref<HTMLElement>): ReactElement {
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className='react-resizable-handle react-resizable-handle-se !w-5 !h-5 !right-0 !bottom-0 !bg-none !p-0 !m-0 opacity-50 hover:opacity-100 transition-opacity'
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Resize_Tile'
      aria-label='Resize'
    >
      <svg
        viewBox='0 0 16 16'
        width='14'
        height='14'
        className='absolute right-[2px] bottom-[2px] text-xyne-gray-500'
        aria-hidden='true'
      >
        <path d='M3 13 L13 3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
        <path d='M8 13 L13 8' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      </svg>
    </div>
  );
}

export interface ComponentPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridComponent extends ComponentTileData {
  position: string;
}

interface ComponentGridProps {
  components: ReadonlyArray<GridComponent>;
  dashboardId: string;
  canEdit?: boolean;
  runtimeContext?: DashboardRuntimeContext | null;
  autoRefreshMs?: number | null;
  onEditComponent?: ((componentId: string) => void) | undefined;
  onAddComponent?: (() => void) | undefined;
  selectedComponentId?: string;
  onSelect?: (componentId: string) => void;
}

const ComponentGrid = ({
  components,
  dashboardId,
  canEdit = true,
  runtimeContext,
  autoRefreshMs,
  onEditComponent,
  onAddComponent,
  selectedComponentId,
  onSelect,
}: ComponentGridProps): ReactElement => {
  const { updatePositions } = useComponentMutations(dashboardId);

  const layout: Layout = useMemo(
    () =>
      components.map(c => {
        const pos = parsePosition(c.position);
        return {
          i: c.id,
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          static: !canEdit,
          minW: MIN_TILE_W,
          minH: MIN_TILE_H,
        } satisfies LayoutItem;
      }),
    [components, canEdit],
  );

  const lastSerializedRef = useRef<Map<string, string>>(new Map());

  const persistLayout = useCallback(
    (next: Layout) => {
      if (!canEdit) return;
      const updates: Array<{ id: string; position: string }> = [];
      for (const item of next) {
        const serialized = JSON.stringify({
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
        const prev = lastSerializedRef.current.get(item.i);
        if (prev === serialized) continue;
        lastSerializedRef.current.set(item.i, serialized);
        const persisted = components.find(c => c.id === item.i)?.position;
        if (prev === undefined && persisted === serialized) continue;
        updates.push({ id: item.i, position: serialized });
      }
      if (updates.length === 0) return;
      updatePositions.mutate(updates, {
        onError: (e: unknown) => {
          toast.error('Failed to save tile positions', { description: getApiErrorMessage(e) });
        },
      });
    },
    [canEdit, components, updatePositions],
  );

  useEffect(() => {
    for (const c of components) {
      if (!lastSerializedRef.current.has(c.id)) {
        lastSerializedRef.current.set(c.id, c.position);
      }
    }
  }, [components]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number>(0);
  const hasComponents = components.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const w = el.clientWidth - padX;
      if (w > 0) setGridWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasComponents]);

  if (components.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-full'>
        {onAddComponent ? (
          <button
            type='button'
            onClick={onAddComponent}
            className='inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-600 transition-colors hover:bg-xyne-gray-50'
            data-track-category='DYNAMIC_DASHBOARD'
            data-track-name='Open_Add_Component_Modal'
          >
            <Plus size={16} className='text-xyne-gray-500' />
            Add Component
          </button>
        ) : (
          <p className='text-sm text-xyne-gray-500'>No components on this dashboard yet.</p>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className='dashboard-grid-wrap p-4'>
      {gridWidth > 0 && (
        <GridLayout
          className='dashboard-grid-layout'
          layout={layout}
          width={gridWidth}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT_PX, margin: TILE_MARGIN_PX }}
          dragConfig={{ enabled: canEdit, handle: '.dashboard-grid-drag-handle' }}
          resizeConfig={{ enabled: canEdit, handles: ['se'], handleComponent: ResizeCornerHandle }}
          onDragStop={persistLayout}
          onResizeStop={persistLayout}
        >
          {components.map(c => (
            <div key={c.id} className='dashboard-grid-item'>
              <ComponentTile
                component={c}
                runtimeContext={runtimeContext ?? null}
                autoRefreshMs={autoRefreshMs ?? null}
                {...(canEdit && onEditComponent ? { onEdit: onEditComponent } : {})}
                {...(onSelect ? { onSelect } : {})}
                isSelected={c.id === selectedComponentId}
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
};

function parsePosition(json: string): ComponentPosition {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Partial<ComponentPosition>;
      if (
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        typeof p.w === 'number' &&
        typeof p.h === 'number'
      ) {
        return { x: p.x, y: p.y, w: p.w, h: p.h };
      }
    }
  } catch {
    /* fall through */
  }
  return { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
}

export default ComponentGrid;
