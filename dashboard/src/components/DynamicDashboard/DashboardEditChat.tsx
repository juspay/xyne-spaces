import { ReactElement, useCallback, useMemo, type ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { LayoutDashboard } from 'lucide-react';
import {
  QueryVisualizationType,
  type DashboardPlan,
  type DashboardToolCall,
  type DraftComponent,
} from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
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
  const z = useZero();
  const { user } = useAuth();

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
    async (
      result: {
        server: Promise<
          { type: 'success' } | { type: 'error'; error: { message?: string } | string | Error }
        >;
      },
      label: string,
    ): Promise<ToolCallResult> => {
      const extractMessage = (e: unknown): string => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object' && 'message' in e) {
          const m = (e as { message?: unknown }).message;
          if (typeof m === 'string' && m.length > 0) return m;
        }
        return 'Unknown error';
      };
      try {
        const res = await result.server;
        if (res.type === 'error') {
          const message = extractMessage(res.error);
          toast.error(`Edit failed (${label})`, { description: message });
          return { status: 'error', message };
        }
        return { status: 'completed' };
      } catch (err) {
        const message = extractMessage(err);
        toast.error(`Edit failed (${label})`, { description: message });
        return { status: 'error', message };
      }
    },
    [],
  );

  const applyToolCall = useCallback(
    async (call: DashboardToolCall): Promise<ToolCallResult> => {
      if (!z) return { status: 'error', message: 'Sync client unavailable' };
      const fail = (message: string): ToolCallResult => {
        toast.error('Edit failed', { description: message });
        return { status: 'error', message };
      };
      const now = Date.now();
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
            const args: Parameters<typeof mutators.dashboard.update>[0] = {
              id: dashboardId,
              timestamp: now,
            };
            if (description !== undefined) args.description = description;
            if (wantsRename) args.name = title;
            if (args.description === undefined && args.name === undefined) {
              return fail('No changes to apply.');
            }
            return await trackMutate(z.mutate(mutators.dashboard.update(args)), 'rename');
          }
          case 'add_component': {
            if (!user?.id) return fail('Not signed in.');
            const id = uuidv4();
            const position =
              call.args.position ?? defaultPositionFor(call.args.visualType, components);
            return await trackMutate(
              z.mutate(
                mutators.dashboardComponent.create({
                  id,
                  dashboardId,
                  visualType: call.args.visualType,
                  title: call.args.title,
                  queryJson: call.args.queryPlan,
                  position: JSON.stringify(position),
                  ...(call.args.componentConfig
                    ? { config: JSON.stringify(call.args.componentConfig) }
                    : {}),
                  createdBy: user.id,
                  mappingId: uuidv4(),
                  timestamp: now,
                }),
              ),
              `add "${call.args.title}"`,
            );
          }
          case 'update_component': {
            const args: Parameters<typeof mutators.dashboardComponent.update>[0] = {
              id: call.args.componentId,
              timestamp: now,
            };
            if (call.args.visualType !== undefined) {
              args.visualType = call.args.visualType;
            }
            if (call.args.title !== undefined) args.title = call.args.title;
            if (call.args.queryPlan !== undefined) {
              args.queryJson = call.args.queryPlan;
            }
            if (call.args.position !== undefined) {
              args.position = JSON.stringify(call.args.position);
            }
            if (call.args.componentConfig !== undefined) {
              args.config = JSON.stringify(call.args.componentConfig);
            }
            return await trackMutate(z.mutate(mutators.dashboardComponent.update(args)), 'update');
          }
          case 'remove_component': {
            return await trackMutate(
              z.mutate(mutators.dashboardComponent.delete({ id: call.args.componentId })),
              'remove',
            );
          }
        }
        return fail('Unknown tool call.');
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [z, dashboardId, components, canRenameOrChangeVisibility, user, trackMutate],
  );

  const handleToolCall = useCallback(
    (call: DashboardToolCall): Promise<ToolCallResult> => applyToolCall(call),
    [applyToolCall],
  );

  const chip: ReactNode = <LayoutDashboard size={11} className='text-xyne-gray-500' />;

  return (
    <DashboardAiChat
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
