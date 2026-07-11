import { ReactElement, useCallback, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutDashboard } from 'lucide-react';
import { getApiErrorMessage } from '../../utils/apiError';
import {
  QueryVisualizationType,
  type DashboardPlan,
  type DashboardToolCall,
  type DraftComponent,
} from '@xyne/shared';
import {
  createComponent,
  deleteComponent,
  updateComponent,
  updateDashboard,
} from '../../services/DynamicDashboard/dashboardCrudService';
import { dashboardKeys } from '../../hooks/useDashboards';
import { DashboardAiChat } from './ai/DashboardAiChat';
import type { ToolCallResult } from './ai/chatTypes';
import { defaultSizeFor, nextOpenPosition } from './componentEditor/queryPlanUtils';

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
  canRenameOrChangeVisibility: boolean;
  onClose: () => void;
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
  canRenameOrChangeVisibility,
  onClose,
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
      const ds = (c.storedPlan as { dataSourceId?: unknown } | undefined)?.dataSourceId;
      if (typeof ds === 'string' && ds.length > 0) return ds;
    }
    return null;
  }, [components]);

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

  const applyToolCall = useCallback(
    async (call: DashboardToolCall): Promise<ToolCallResult> => {
      const fail = (message: string): ToolCallResult => {
        toast.error('Edit failed', { description: message });
        return { status: 'error', message };
      };
      try {
        switch (call.tool) {
          case 'set_dashboard_meta': {
            const { title, description } = call.args;
            const wantsRename = title !== undefined;
            if (wantsRename && !canRenameOrChangeVisibility) {
              return fail(
                "You don't have permission to rename this dashboard. Only owners can change the name.",
              );
            }
            const patch: { name?: string; description?: string } = {};
            if (description !== undefined) patch.description = description;
            if (wantsRename) patch.name = title;
            if (patch.description === undefined && patch.name === undefined) {
              return fail('No changes to apply.');
            }
            return await trackMutate(() => updateDashboard(dashboardId, patch), 'rename');
          }
          case 'add_component': {
            const position =
              call.args.position ?? defaultPositionFor(call.args.visualType, components);
            return await trackMutate(
              () =>
                createComponent(dashboardId, {
                  visualType: call.args.visualType,
                  title: call.args.title,
                  queryJson: call.args.queryPlan,
                  position: JSON.stringify(position),
                  ...(call.args.componentConfig
                    ? { config: JSON.stringify(call.args.componentConfig) }
                    : {}),
                }),
              `add "${call.args.title}"`,
            );
          }
          case 'update_component': {
            const patch: {
              visualType?: QueryVisualizationType;
              title?: string;
              queryJson?: unknown;
              position?: string;
              config?: string;
            } = {};
            if (call.args.visualType !== undefined) {
              patch.visualType = call.args.visualType;
            }
            if (call.args.title !== undefined) patch.title = call.args.title;
            if (call.args.queryPlan !== undefined) {
              patch.queryJson = call.args.queryPlan;
            }
            if (call.args.position !== undefined) {
              patch.position = JSON.stringify(call.args.position);
            }
            if (call.args.componentConfig !== undefined) {
              patch.config = JSON.stringify(call.args.componentConfig);
            }
            return await trackMutate(() => updateComponent(call.args.componentId, patch), 'update');
          }
          case 'remove_component': {
            return await trackMutate(() => deleteComponent(call.args.componentId), 'remove');
          }
        }
        return fail('Unknown tool call.');
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [dashboardId, components, canRenameOrChangeVisibility, trackMutate],
  );

  const handleToolCall = useCallback(
    (call: DashboardToolCall): Promise<ToolCallResult> => applyToolCall(call),
    [applyToolCall],
  );

  const chip: ReactNode = <LayoutDashboard size={11} className='text-muted-foreground' />;

  return (
    <DashboardAiChat
      className='flex flex-col h-full w-full rounded-xl bg-background border border-border overflow-hidden'
      dataSourceId={primaryDataSourceId}
      currentPlan={currentPlan}
      buildPrompt={text => text}
      onToolCall={handleToolCall}
      emptyStatePrompt='How can I help with this dashboard?'
      starterPrompts={EDIT_STARTERS}
      contextChips={[{ icon: chip, label: dashboardName, maxWidth: 180 }]}
      onClose={onClose}
      trackCategory='DYNAMIC_DASHBOARD'
    />
  );
};

export default DashboardEditChat;
