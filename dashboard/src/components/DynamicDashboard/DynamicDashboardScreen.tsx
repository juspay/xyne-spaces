import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCachedQuery } from '@xyne/shared/hooks';
import { toast } from 'sonner';
import { LayoutDashboard, MoreVertical, Plus, Share, Sparkles } from 'lucide-react';
import { DashboardRole } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { Dialog } from '../ui/Dialog';
import { DashboardShareModal } from './DashboardShareModal';
import { ComponentGrid, type GridComponent } from './ComponentGrid';
import { ComponentEditorModal } from './ComponentEditorModal';
import { DashboardEditChat } from './DashboardEditChat';
import { TimeRangePicker, AutoRefreshPicker } from './TimeRangePicker';
import {
  DashboardVariablesBar,
  type DashboardVariableDef,
  type DashboardVariableState,
} from './DashboardVariablesBar';
import type {
  DashboardRuntimeContext,
  DashboardTimeRange,
  DashboardVariableValue,
} from '../../services/DynamicDashboard/planResolver';

const DynamicDashboardScreen = (): ReactElement => {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const { user } = useAuth();
  const z = useZero();
  const [shareOpen, setShareOpen] = useState(false);
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const [dashboard] = useCachedQuery(queries.getDashboard({ dashboardId: dashboardId || '' }), {
    enabled: !!dashboardId,
  });

  const dashboardConfig = useMemo<DashboardConfigShape>(() => {
    try {
      const raw = (dashboard?.config ? JSON.parse(dashboard.config) : {}) as {
        timeRange?: unknown;
        autoRefreshMs?: unknown;
        variables?: unknown;
        variableValues?: unknown;
      };
      return {
        timeRange: (raw.timeRange as DashboardTimeRange | null) ?? null,
        autoRefreshMs: typeof raw.autoRefreshMs === 'number' ? raw.autoRefreshMs : null,
        variables: Array.isArray(raw.variables) ? (raw.variables as DashboardVariableDef[]) : [],
        variableValues:
          raw.variableValues && typeof raw.variableValues === 'object'
            ? (raw.variableValues as Record<string, DashboardVariableState>)
            : {},
      };
    } catch {
      return { timeRange: null, autoRefreshMs: null, variables: [], variableValues: {} };
    }
  }, [dashboard?.config]);

  const runtimeContext: DashboardRuntimeContext = useMemo(() => {
    const variables: Record<string, DashboardVariableValue> = {};
    for (const def of dashboardConfig.variables) {
      const state = dashboardConfig.variableValues[def.name];
      const value = state?.current ?? def.defaultValue ?? null;
      if (value !== null) variables[def.name] = { value };
    }
    return {
      timeRange: dashboardConfig.timeRange ?? null,
      variables,
    };
  }, [dashboardConfig.timeRange, dashboardConfig.variables, dashboardConfig.variableValues]);

  const persistConfig = useCallback(
    (partial: Partial<DashboardConfigShape>) => {
      if (!z || !dashboard) return;
      const next: DashboardConfigShape = { ...dashboardConfig, ...partial };
      const result = z.mutate(
        mutators.dashboard.update({
          id: dashboard.id,
          config: JSON.stringify(next),
          timestamp: Date.now(),
        }),
      );
      void result.server
        .then(res => {
          if (res.type === 'error') {
            toast.error('Failed to save dashboard settings', {
              description: res.error instanceof Error ? res.error.message : undefined,
            });
          }
        })
        .catch((err: unknown) => {
          toast.error('Failed to save dashboard settings', {
            description: err instanceof Error ? err.message : undefined,
          });
        });
    },
    [z, dashboard, dashboardConfig],
  );

  const tiles = useMemo(
    () =>
      (dashboard?.queryMappings ?? [])
        .map(m => m.query)
        .filter((q): q is NonNullable<typeof q> => !!q && q.queryType === 'external'),
    [dashboard?.queryMappings],
  );

  const inferredDsId = useMemo<string | undefined>(() => {
    for (const q of tiles) {
      const plan = q.queryJson as { dataSourceId?: unknown } | null;
      if (plan && typeof plan.dataSourceId === 'string' && plan.dataSourceId) {
        return plan.dataSourceId;
      }
    }
    return undefined;
  }, [tiles]);

  const gridComponents: ReadonlyArray<GridComponent> = useMemo(() => {
    return tiles.map(q => {
      const storedPlan =
        q.queryJson && typeof q.queryJson === 'object'
          ? (q.queryJson as Record<string, unknown>)
          : undefined;
      let componentConfig: Record<string, unknown> | undefined;
      try {
        componentConfig = q.config ? (JSON.parse(q.config) as Record<string, unknown>) : undefined;
      } catch {
        componentConfig = undefined;
      }
      return {
        id: q.id,
        dashboardId: dashboard?.id,
        visualType: q.visualType as GridComponent['visualType'],
        title: q.title ?? null,
        position: q.position,
        updatedAt: q.updatedAt,
        storedPlan,
        componentConfig: componentConfig as { timeColumn?: string } | undefined,
      };
    });
  }, [tiles, dashboard?.id]);

  if (!dashboardId) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
        Missing dashboard id in URL.
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
        Loading dashboard...
      </div>
    );
  }

  const participantCount = dashboard.participants?.length ?? 0;
  const componentCount = gridComponents.length;

  const selfParticipant = dashboard.participants?.find(p => p.userId === user?.id);
  const isOwner = dashboard.createdBy === user?.id || selfParticipant?.role === DashboardRole.OWNER;
  const isEditor = selfParticipant?.role === DashboardRole.EDITOR;
  const canShare = isOwner || isEditor;

  if (addComponentOpen) {
    return (
      <ComponentEditorModal
        dashboardId={dashboard.id}
        dashboardName={dashboard.name}
        defaultDataSourceId={inferredDsId}
        existingPositions={gridComponents.map(c => c.position)}
        onClose={() => setAddComponentOpen(false)}
      />
    );
  }
  if (editingComponentId) {
    const row = tiles.find(q => q.id === editingComponentId);
    if (row) {
      return (
        <ComponentEditorModal
          dashboardId={dashboard.id}
          dashboardName={dashboard.name}
          existingPositions={gridComponents.map(c => c.position)}
          editingComponent={{
            id: row.id,
            visualType: row.visualType as GridComponent['visualType'],
            title: row.title ?? null,
            queryJson:
              row.queryJson && typeof row.queryJson === 'object'
                ? (row.queryJson as Record<string, unknown>)
                : {},
            config: row.config ?? '{}',
          }}
          onClose={() => setEditingComponentId(null)}
        />
      );
    }
  }

  return (
    <div className='flex h-full bg-white min-w-0'>
      <div className='flex-1 flex flex-col min-w-0'>
        <div className='flex items-center justify-between gap-3 h-12 px-4 border-b border-xyne-gray-200 shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            <LayoutDashboard className='w-4 h-4 text-xyne-gray-500 shrink-0' />
            <span className='text-[13px] leading-[18px] font-medium text-xyne-gray-900 truncate'>
              {dashboard.name}
            </span>
          </div>
          <div className='flex items-center gap-1.5'>
            {canShare && (
              <button
                type='button'
                onClick={() => setAddComponentOpen(true)}
                className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-xyne-primary-500 text-[13px] leading-[18px] font-medium text-white transition-colors hover:bg-xyne-primary-600'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Open_Add_Component'
              >
                <Plus size={14} />
                Add Component
              </button>
            )}
            {canShare && (
              <button
                type='button'
                onClick={() => setShareOpen(true)}
                className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 transition-colors hover:bg-xyne-gray-50'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Open_Share_Modal'
              >
                <Share size={14} className='text-xyne-gray-600' />
                Share
              </button>
            )}
            {canShare && (
              <button
                type='button'
                onClick={() => setChatOpen(v => !v)}
                aria-pressed={chatOpen}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] leading-[18px] font-medium transition-colors ${
                  chatOpen
                    ? 'border-xyne-primary-500 bg-xyne-primary-500/10 text-xyne-gray-900'
                    : 'border-xyne-gray-200 bg-white text-xyne-gray-900 hover:bg-xyne-gray-50'
                }`}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Toggle_Edit_Chat'
              >
                <Sparkles size={14} className='text-xyne-primary-500' />
                Chat
              </button>
            )}
            <button
              type='button'
              className='inline-flex items-center justify-center w-8 h-8 rounded-lg text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
              aria-label='Dashboard options'
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        <div className='flex items-start justify-between gap-3 px-6 pt-5 pb-4 shrink-0'>
          <div className='min-w-0'>
            <h1 className='text-[18px] leading-5 font-medium text-xyne-gray-900 truncate'>
              {dashboard.name}
            </h1>
            {dashboard.description ? (
              <p className='mt-1 text-sm leading-5 text-xyne-gray-500'>{dashboard.description}</p>
            ) : (
              <span className='mt-1 inline-block text-sm leading-5 text-xyne-gray-500'>
                + Add description..
              </span>
            )}
            <div className='flex items-center gap-2 mt-2 text-xs text-xyne-gray-400'>
              <span className='capitalize'>{dashboard.visibility}</span>
              <span>·</span>
              <span>
                {participantCount} participant{participantCount === 1 ? '' : 's'}
              </span>
              <span>·</span>
              <span>
                {componentCount} component{componentCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className='flex items-center gap-2 shrink-0'>
            <TimeRangePicker
              value={dashboardConfig.timeRange}
              onChange={(next: DashboardTimeRange | null) => persistConfig({ timeRange: next })}
            />
            <AutoRefreshPicker
              value={dashboardConfig.autoRefreshMs}
              onChange={next => persistConfig({ autoRefreshMs: next })}
            />
          </div>
        </div>

        <DashboardVariablesBar
          definitions={dashboardConfig.variables}
          values={dashboardConfig.variableValues}
          canEdit={Boolean(canShare)}
          onDefinitionsChange={next => persistConfig({ variables: next })}
          onValueChange={(name, state) =>
            persistConfig({
              variableValues: { ...dashboardConfig.variableValues, [name]: state },
            })
          }
        />
        <div className='flex-1 overflow-auto min-h-0'>
          <ComponentGrid
            components={gridComponents}
            runtimeContext={runtimeContext}
            autoRefreshMs={dashboardConfig.autoRefreshMs}
            canEdit={Boolean(canShare)}
            onEditComponent={canShare ? setEditingComponentId : undefined}
            onAddComponent={canShare ? () => setAddComponentOpen(true) : undefined}
          />
        </div>
      </div>

      {canShare && chatOpen && (
        <DashboardEditChat
          key={dashboard.id}
          dashboardId={dashboard.id}
          dashboardName={dashboard.name}
          dashboardDescription={dashboard.description ?? null}
          components={gridComponents.map(c => ({
            id: c.id,
            visualType: c.visualType,
            title: c.title ?? null,
            storedPlan: c.storedPlan,
            componentConfig: c.componentConfig,
            position: c.position,
          }))}
          canRenameOrChangeVisibility={isOwner}
          onClose={() => setChatOpen(false)}
        />
      )}

      <Dialog
        open={shareOpen}
        onOpenChange={open => !open && setShareOpen(false)}
        title='Share Dashboard'
      >
        <DashboardShareModal
          dashboard={{
            id: dashboard.id,
            createdBy: dashboard.createdBy,
            visibility: dashboard.visibility,
          }}
          isOwner={isOwner}
          isEditor={isEditor}
          preloadedParticipants={dashboard.participants}
        />
      </Dialog>
    </div>
  );
};

DynamicDashboardScreen.displayName = 'DynamicDashboardScreen';

interface DashboardConfigShape {
  timeRange: DashboardTimeRange | null;
  autoRefreshMs: number | null;
  variables: DashboardVariableDef[];
  variableValues: Record<string, DashboardVariableState>;
}

export default DynamicDashboardScreen;
