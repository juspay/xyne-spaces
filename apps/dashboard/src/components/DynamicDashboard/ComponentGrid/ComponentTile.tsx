import { QueryVisualizationType } from '@xyne/shared';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Lightbulb,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  Component as ReactComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { toast } from 'sonner';
import { useComponentData } from '../../../hooks/useComponentData';
import { useResolvedComponentData } from '../../../hooks/useResolvedComponentData';
import type {
  ComponentRuntimeConfig,
  DashboardRuntimeContext,
} from '../../../services/DynamicDashboard/planResolver';
import { formatQueryError } from '../../../utils/queryErrorFormatter';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useComponentMutations } from '../../../hooks/useDashboards';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { getRendererForType } from './renderers';
import { formatFetchError, isVisualType, untitledFor } from './utils';
import { ComponentPreviewDialog } from './preview';
import { getDataSourceId } from '../../../hooks/useComponentPreview';

export interface ComponentTileData {
  id: string;
  visualType: QueryVisualizationType;
  title?: string | null;
  data?: unknown;
  updatedAt?: number | undefined;
  error?: string | null;
  loading?: boolean;
  storedPlan?: Record<string, unknown> | undefined;
  componentConfig?: ComponentRuntimeConfig | undefined;
  dashboardId?: string | undefined;
  position?: string | undefined;
}

interface ComponentTileProps {
  component: ComponentTileData;
  runtimeContext?: DashboardRuntimeContext | null;
  autoRefreshMs?: number | null;
  onEdit?: (componentId: string) => void;
  // AI-chat focus: clicking the tile toggles it as the chat's focused
  // component (ring highlight); the drag-handle header is excluded.
  isSelected?: boolean;
  onSelect?: (componentId: string) => void;
}

const ComponentTile = ({
  component,
  runtimeContext,
  autoRefreshMs,
  onEdit,
  isSelected,
  onSelect,
}: ComponentTileProps): ReactElement => {
  const { create, remove } = useComponentMutations(component.dashboardId ?? '');
  const visualType: QueryVisualizationType | null = isVisualType(component.visualType)
    ? component.visualType
    : null;
  const renderable = visualType !== null && getRendererForType(visualType) !== undefined;

  const hasContext =
    !!runtimeContext &&
    (!!runtimeContext.timeRange ||
      (!!runtimeContext.variables && Object.keys(runtimeContext.variables).length > 0));

  const canResolveLocally = hasContext && !!component.storedPlan && renderable;

  const cachedFetchEnabled =
    !component.loading &&
    !component.error &&
    !canResolveLocally &&
    (component.data === undefined || component.data === null);

  const cachedQuery = useComponentData(
    cachedFetchEnabled ? component.id : '',
    component.updatedAt,
    autoRefreshMs ?? null,
  );

  const resolvedQuery = useResolvedComponentData({
    componentId: component.id,
    visualType: visualType ?? QueryVisualizationType.BAR_CHART,
    storedPlan: component.storedPlan ?? {},
    componentConfig: component.componentConfig,
    runtimeContext,
    updatedAt: component.updatedAt,
    autoRefreshMs: autoRefreshMs ?? null,
    enabled: canResolveLocally,
  });

  const query = canResolveLocally ? resolvedQuery : cachedQuery;
  const fetchEnabled = cachedFetchEnabled || canResolveLocally;

  const isPersisted = fetchEnabled && Boolean(component.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = getDataSourceId(component.storedPlan) !== null;

  const handleDelete = useCallback(() => {
    remove.mutate(component.id, {
      onSuccess: () => {
        toast.success('Component deleted');
      },
      onError: e => {
        toast.error('Failed to delete component', { description: getApiErrorMessage(e) });
      },
      onSettled: () => {
        setDeleteOpen(false);
      },
    });
  }, [component.id, remove]);

  const handleDuplicate = useCallback(() => {
    if (visualType === null) return;
    if (!component.dashboardId) {
      toast.error('Failed to duplicate component', {
        description: 'Parent dashboard id is missing from this tile',
      });
      return;
    }
    const sourcePos = (() => {
      try {
        return JSON.parse(component.position ?? '{}') as {
          x?: unknown;
          y?: unknown;
          w?: unknown;
          h?: unknown;
        };
      } catch {
        return {} as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      }
    })();
    const pos = {
      x: typeof sourcePos.x === 'number' ? sourcePos.x : 0,
      y:
        typeof sourcePos.y === 'number'
          ? sourcePos.y + (typeof sourcePos.h === 'number' ? sourcePos.h : 2)
          : 0,
      w: typeof sourcePos.w === 'number' ? sourcePos.w : 6,
      h: typeof sourcePos.h === 'number' ? sourcePos.h : 4,
    };
    create.mutate(
      {
        visualType,
        ...(component.title ? { title: `${component.title} (copy)` } : {}),
        queryJson: component.storedPlan ?? {},
        position: JSON.stringify(pos),
      },
      {
        onSuccess: () => {
          toast.success('Component duplicated');
        },
        onError: e => {
          toast.error('Failed to duplicate component', { description: getApiErrorMessage(e) });
        },
      },
    );
  }, [component, visualType, create]);

  return (
    <div
      className={`group/tile flex flex-col h-full bg-white border rounded-2xl overflow-hidden transition-shadow ${isSelected ? 'border-xyne-green-500 ring-2 ring-xyne-green-500/20 shadow-md' : 'border-xyne-gray-200 shadow-sm hover:shadow-md'}`}
      {...(onSelect
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': !!isSelected,
            'data-track-category': 'DYNAMIC_DASHBOARD',
            'data-track-name': 'Dashboard_Tile_Select',
            onClick: (e: MouseEvent<HTMLDivElement>): void => {
              // Menus and dialogs render in portals under document.body; React
              // still bubbles their clicks here, so ignore any target that isn't
              // physically inside this tile.
              if (!e.currentTarget.contains(e.target as Node)) return;
              // The drag-handle header is not a select target — ignore clicks originating there.
              if ((e.target as HTMLElement).closest('.dashboard-grid-drag-handle')) return;
              onSelect(component.id);
            },
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>): void => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onSelect(component.id);
              }
            },
          }
        : {})}
    >
      <div className='dashboard-grid-drag-handle flex items-center justify-between gap-2 pl-5 pr-2.5 pt-3.5 pb-1 cursor-move select-none'>
        <h3 className='text-[11px] uppercase tracking-[0.1em] font-semibold text-xyne-gray-500 truncate'>
          {component.title || untitledFor(visualType)}
        </h3>
        {isPersisted ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className='shrink-0 p-1 rounded-md text-xyne-gray-500 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-xyne-gray-100 transition-opacity'
                aria-label='Component menu'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Open_Component_Menu'
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {onEdit && (
                <DropdownMenuItem
                  onClick={() => onEdit(component.id)}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Edit_Component'
                >
                  <Pencil size={14} className='mr-2' />
                  Edit
                </DropdownMenuItem>
              )}
              {canPreview && (
                <DropdownMenuItem
                  onClick={() => setPreviewOpen(true)}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Preview_Component'
                >
                  <Eye size={14} className='mr-2' />
                  Preview
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  void handleDuplicate();
                }}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Duplicate_Component'
              >
                <Copy size={14} className='mr-2' />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='OPEN_DELETE_COMPONENT_CONFIRM'
                className='text-rose-600'
              >
                <Trash2 size={14} className='mr-2' />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            className='shrink-0 p-1 text-xyne-gray-500 opacity-0 cursor-not-allowed rounded-md'
            aria-label='Component menu'
            disabled
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
      <div className='flex-1 min-h-0 px-2 pb-3 flex flex-col overflow-hidden'>
        <TileBodyErrorBoundary>
          {component.error ? (
            <ErrorState message={component.error} />
          ) : !renderable ? (
            <ErrorState message={`Unknown component type "${String(component.visualType)}"`} />
          ) : component.loading ? (
            <LoadingState />
          ) : !fetchEnabled ? (
            renderBody(visualType, component.data, component.title, component.componentConfig)
          ) : query.isLoading ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState message={formatFetchError(query.error)} />
          ) : query.data ? (
            renderBody(visualType, query.data.data, component.title, component.componentConfig)
          ) : (
            <LoadingState />
          )}
        </TileBodyErrorBoundary>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={open => !open && setDeleteOpen(false)}
        title='Delete Component'
      >
        <div className='p-6'>
          <p className='text-muted-foreground mb-6'>
            Delete this component? The underlying QueryPlan is removed too — this can&apos;t be
            undone.
          </p>
          <div className='flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={() => setDeleteOpen(false)}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Cancel_Delete_Component'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                void handleDelete();
              }}
              trackId='delete_component'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Confirm_Delete_Component'
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>

      {canPreview && (
        <ComponentPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          component={component}
        />
      )}
    </div>
  );
};

function renderBody(
  visualType: QueryVisualizationType | null,
  data: unknown,
  title?: string | null,
  config?: ComponentRuntimeConfig,
): ReactElement {
  const Renderer = visualType ? getRendererForType(visualType) : undefined;
  if (!Renderer) {
    return <ErrorState message={`Unknown component type "${String(visualType)}"`} />;
  }
  return (
    <Renderer
      data={data}
      {...(title ? { title } : {})}
      {...(config?.unit ? { unit: config.unit } : {})}
      {...(config?.unitPosition ? { unitPosition: config.unitPosition } : {})}
    />
  );
}

function ErrorState({ message }: { message: string }): ReactElement {
  const formatted = formatQueryError(message);
  const [showRaw, setShowRaw] = useState(false);
  const wasFormatted = formatted.summary !== message;
  return (
    <div className='flex-1 min-h-0 w-full relative overflow-hidden'>
      <div className='absolute inset-0 overflow-y-auto'>
        <div className='flex flex-col items-center justify-center py-6 px-5 text-center'>
          <div className='flex items-center justify-center w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-500 mb-3'>
            <AlertCircle className='w-5 h-5' />
          </div>
          <h3 className='text-sm font-semibold text-foreground mb-1.5'>{formatted.title}</h3>
          <p className='text-xs text-muted-foreground max-w-md leading-relaxed'>
            {formatted.summary}
          </p>
        </div>

        {formatted.details && formatted.details.length > 0 && (
          <div className='mx-5 mb-3 rounded-md border border-border bg-muted/30 overflow-hidden'>
            {formatted.details.map((d, i) => (
              <div
                key={i}
                className={`flex items-center justify-between px-3 py-2 text-xs ${
                  i < formatted.details!.length - 1 ? 'border-b border-border/60' : ''
                }`}
              >
                <span className='font-mono text-foreground/85 truncate mr-3'>{d.label}</span>
                <span className='inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-background border border-border text-muted-foreground shrink-0'>
                  {d.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {formatted.suggestion && (
          <div className='mx-5 mb-3 flex items-start gap-2 text-xs text-foreground/80 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 rounded-md px-3 py-2'>
            <Lightbulb className='w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500' />
            <span className='leading-relaxed'>{formatted.suggestion}</span>
          </div>
        )}

        {wasFormatted && (
          <div className='mx-5 mb-3'>
            <button
              type='button'
              onClick={() => setShowRaw(s => !s)}
              className='inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Toggle_Tile_Raw_Error'
            >
              {showRaw ? <ChevronDown className='w-3 h-3' /> : <ChevronRight className='w-3 h-3' />}
              Technical details
            </button>
            {showRaw && (
              <pre className='mt-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words bg-muted/40 rounded-md p-2.5 max-h-40 overflow-y-auto border border-border/60'>
                {formatted.raw}
              </pre>
            )}
          </div>
        )}

        {!wasFormatted && (
          <pre className='mx-5 mb-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words bg-muted/40 rounded-md p-2.5 max-h-40 overflow-y-auto border border-border/60'>
            {formatted.raw}
          </pre>
        )}
      </div>
    </div>
  );
}

class TileBodyErrorBoundary extends ReactComponent<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error): void {
    logger.error(Event.FRONTEND_ERROR, {
      type: 'dynamic_dashboard_render',
      message: 'Component tile render failed',
      error,
    });
  }
  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorState message={`Render error: ${this.state.error.message}`} />;
    }
    return this.props.children;
  }
}

function LoadingState(): ReactElement {
  return (
    <div className='flex flex-col gap-3 h-full p-4'>
      <div className='h-6 w-1/3 rounded bg-muted animate-pulse' />
      <div className='flex-1 rounded bg-muted/60 animate-pulse' />
      <div className='flex gap-2'>
        <div className='h-2.5 w-12 rounded bg-muted animate-pulse' />
        <div className='h-2.5 w-12 rounded bg-muted animate-pulse' />
        <div className='h-2.5 w-12 rounded bg-muted animate-pulse' />
      </div>
    </div>
  );
}

export default ComponentTile;
import { Event, logger } from '../../../utils/logger';
