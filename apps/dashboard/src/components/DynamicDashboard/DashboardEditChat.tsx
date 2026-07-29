import { ReactElement, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutDashboard } from 'lucide-react';
import { getApiErrorMessage } from '../../utils/apiError';
import { QueryVisualizationType, type DashboardPlan, type DraftComponent } from '@xyne/shared';
import { createComponent } from '../../services/DynamicDashboard/dashboardCrudService';
import { dashboardKeys } from '../../hooks/useDashboards';
import { DashboardAiChat } from './ai/DashboardAiChat';
import { DataSourceChip } from './ai/DataSourceChip';
import type { DrillPayload, ToolCallResult } from './ai/chatTypes';
import { defaultSizeFor, nextOpenPosition } from './componentEditor/queryPlanUtils';
import type { DataSourceListItem } from '../../services/DynamicDashboard/dataSourcesService';

interface ExistingComponent {
  id: string;
  visualType: QueryVisualizationType;
  title: string | null;
  storedPlan: Record<string, unknown> | undefined;
  componentConfig: { timeColumn?: string } | undefined;
  position: string;
}

interface DashboardEditChatProps {
  dashboardId: string;
  dashboardName: string;
  dashboardDescription: string | null;
  components: ReadonlyArray<ExistingComponent>;
  dataSources: ReadonlyArray<DataSourceListItem>;
  onClose: () => void;
  focusedComponentId?: string;
  focusedComponentTitle?: string;
  onClearFocus?: () => void;
}

const EDIT_STARTERS: ReadonlyArray<string> = [
  'Add a KPI for total count',
  'Make the bar chart a line chart',
  'Sort the top table by most recent',
  'Remove the smallest tile',
];

function defaultPositionFor(
  visualType: QueryVisualizationType,
  existing: ReadonlyArray<ExistingComponent>,
): { x: number; y: number; w: number; h: number } {
  return nextOpenPosition(
    existing.map(c => c.position),
    defaultSizeFor(visualType),
  );
}

export const DashboardEditChat = ({
  dashboardId,
  dashboardName,
  dashboardDescription,
  components,
  dataSources,
  onClose,
  focusedComponentId,
  focusedComponentTitle,
  onClearFocus,
}: DashboardEditChatProps): ReactElement => {
  const queryClient = useQueryClient();

  const currentPlan = useMemo<DashboardPlan>(() => {
    const planComponents: DraftComponent[] = [];
    for (const c of components) {
      if (!c.storedPlan) continue;
      let pos: { x: number; y: number; w: number; h: number };
      try {
        pos = JSON.parse(c.position) as { x: number; y: number; w: number; h: number };
      } catch {
        continue;
      }
      planComponents.push({
        id: c.id,
        visualType: c.visualType,
        title: c.title ?? '',
        queryPlan: c.storedPlan as DraftComponent['queryPlan'],
        position: pos,
        ...(c.componentConfig ? { componentConfig: c.componentConfig } : {}),
      });
    }
    return {
      ...(dashboardName ? { title: dashboardName } : {}),
      ...(dashboardDescription ? { description: dashboardDescription } : {}),
      components: planComponents,
    };
  }, [components, dashboardName, dashboardDescription]);

  const primaryDataSourceId = useMemo<string | null>(() => {
    for (const c of components) {
      const plan = c.storedPlan as
        | {
            dataSourceId?: unknown;
            params?: { history?: { queryPlan?: { dataSourceId?: unknown } } };
          }
        | undefined;
      const top = plan?.dataSourceId;
      if (typeof top === 'string' && top.length > 0) return top;
      const nested = plan?.params?.history?.queryPlan?.dataSourceId;
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
    return null;
  }, [components]);

  const [dataSourceId, setDataSourceId] = useState<string | null>(primaryDataSourceId);
  useEffect(() => {
    if (dataSourceId !== null) return;
    if (primaryDataSourceId !== null) {
      setDataSourceId(primaryDataSourceId);
      return;
    }
    // Nothing to infer from existing components, and the chip hides itself when
    // only one source is ready — auto-select that sole source so a fresh
    // dashboard's chat isn't permanently stuck on "No data source".
    const ready = dataSources.filter(d => d.ingestionStatus === 'complete');
    if (ready.length === 1) setDataSourceId(ready[0]!.id);
  }, [primaryDataSourceId, dataSourceId, dataSources]);

  // DataSourceChip renders null itself when fewer than two sources are ready.
  const dataSourcePicker = (
    <DataSourceChip
      trackName='Dashboard_Chat_Data_Source_Chip'
      dataSourceId={dataSourceId}
      setDataSourceId={setDataSourceId}
      dataSources={dataSources}
    />
  );

  const trackMutate = useCallback(
    async (op: () => Promise<unknown>, label: string): Promise<ToolCallResult> => {
      try {
        await op();
        await queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
        return { status: 'completed' };
      } catch (err) {
        const message = getApiErrorMessage(err);
        toast.error(`Edit failed (${label})`, { description: message });
        return { status: 'error', message };
      }
    },
    [queryClient, dashboardId],
  );

  const addTile = useCallback(
    (
      visualType: QueryVisualizationType,
      title: string,
      queryJson: unknown,
      label: string,
      extra?: { position?: { x: number; y: number; w: number; h: number }; config?: string },
    ): Promise<ToolCallResult> => {
      const position = extra?.position ?? defaultPositionFor(visualType, components);
      return trackMutate(
        () =>
          createComponent(dashboardId, {
            visualType,
            title,
            queryJson,
            position: JSON.stringify(position),
            ...(extra?.config ? { config: extra.config } : {}),
          }),
        label,
      );
    },
    [dashboardId, components, trackMutate],
  );

  const onDashboardMutated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.dashboard(dashboardId) });
  }, [queryClient, dashboardId]);

  const addDrillToDashboard = useCallback(
    async (args: DrillPayload): Promise<boolean> => {
      const res = await addTile(args.visualType, args.title, args.queryPlan, 'add_drill');
      return res.status !== 'error';
    },
    [addTile],
  );

  const chip: ReactNode = <LayoutDashboard size={11} className='text-muted-foreground' />;

  return (
    <DashboardAiChat
      className='flex flex-col h-full w-full rounded-xl bg-background border border-border overflow-hidden'
      dataSourceId={dataSourceId}
      dashboardId={dashboardId}
      currentPlan={currentPlan}
      buildPrompt={text => text}
      onAddDrill={addDrillToDashboard}
      onDashboardMutated={onDashboardMutated}
      emptyStatePrompt='How can I help with this dashboard?'
      starterPrompts={EDIT_STARTERS}
      contextChips={[
        { icon: chip, label: dashboardName, maxWidth: 180 },
        ...(focusedComponentId && focusedComponentTitle
          ? [
              {
                label: `◉ ${focusedComponentTitle}`,
                maxWidth: 180,
                ...(onClearFocus ? { onRemove: onClearFocus } : {}),
              },
            ]
          : []),
      ]}
      onClose={onClose}
      trackCategory='DYNAMIC_DASHBOARD'
      {...(focusedComponentId ? { focusedComponentId } : {})}
      dataSourcePicker={dataSourcePicker}
    />
  );
};
