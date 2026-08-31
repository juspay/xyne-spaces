import { LayoutDashboard } from 'lucide-react';
import { useCallback, type ReactElement } from 'react';
import type { DashboardToolCall } from '@xyne/shared';
import type { DataSourceListItem } from '../../../services/DynamicDashboard/dataSourcesService';
import { DashboardAiChat } from '../ai/DashboardAiChat';
import { DataSourceChip } from '../ai/DataSourceChip';
import type { DrillPayload } from '../ai/chatTypes';

export interface AiSidePanelProps {
  dashboardId: string;
  dashboardName: string;
  dataSourceId: string;
  setDataSourceId: (id: string) => void;
  dataSources: ReadonlyArray<DataSourceListItem>;
  lastError: string | null;
  onToolCall: (call: DashboardToolCall) => void;
}

export const AiSidePanel = ({
  dashboardId,
  dashboardName,
  dataSourceId,
  setDataSourceId,
  dataSources,
  lastError,
  onToolCall,
}: AiSidePanelProps): ReactElement => {
  // The editor drafts a component locally, so the agent must NOT persist a
  // tile — drill_result is the validate-only tool that streams back exactly
  // the { title, visualType, queryPlan } the builder needs.
  const buildPrompt = useCallback(
    (text: string) =>
      `Present exactly ONE drill_result call (title, visualType, queryPlan) for the chart described below — the user is drafting a component in the editor, so do NOT call add_component or set_dashboard_meta. ` +
      `If the requested table or column doesn't exist on this source, call suggest_components with alternatives instead. The user wants: ${text}`,
    [],
  );

  const handleDrillResult = useCallback(
    (drill: DrillPayload, ctx: { abort: () => void }): boolean => {
      onToolCall({
        tool: 'add_component',
        args: {
          visualType: drill.visualType,
          title: drill.title,
          queryPlan: drill.queryPlan,
        },
      } as DashboardToolCall);
      ctx.abort();
      return true;
    },
    [onToolCall],
  );

  // DataSourceChip renders null itself when fewer than two sources are ready.
  const picker = (
    <DataSourceChip
      trackName='Component_Editor_Data_Source_Chip'
      dataSourceId={dataSourceId || null}
      setDataSourceId={setDataSourceId}
      dataSources={dataSources}
    />
  );

  return (
    <DashboardAiChat
      dataSourceId={dataSourceId || null}
      dashboardId={dashboardId}
      buildPrompt={buildPrompt}
      onDrillResult={handleDrillResult}
      emptyStatePrompt='What kind of chart would you like to create?'
      contextChips={[
        {
          icon: <LayoutDashboard size={11} className='text-xyne-gray-500' />,
          label: dashboardName,
          maxWidth: 120,
        },
      ]}
      dataSourcePicker={picker}
      lastError={lastError}
      trackCategory='COMPONENT_EDITOR'
      className='flex flex-col h-full'
    />
  );
};
