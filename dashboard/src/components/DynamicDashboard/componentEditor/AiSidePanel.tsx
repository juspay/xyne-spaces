import { LayoutDashboard } from 'lucide-react';
import { useCallback, useMemo, type ReactElement } from 'react';
import type { DashboardToolCall } from '@xyne/shared';
import { DashboardAiChat } from '../ai/DashboardAiChat';
import { Select } from './formControls';

export interface AiSidePanelProps {
  dashboardName: string;
  dataSourceId: string;
  setDataSourceId: (id: string) => void;
  dataSources: Array<{ id: string; name: string; ingestionStatus: string }>;
  lastError: string | null;
  onToolCall: (call: DashboardToolCall) => void;
}

export const AiSidePanel = ({
  dashboardName,
  dataSourceId,
  setDataSourceId,
  dataSources,
  lastError,
  onToolCall,
}: AiSidePanelProps): ReactElement => {
  const readyDataSources = useMemo(
    () => dataSources.filter(d => d.ingestionStatus === 'complete'),
    [dataSources],
  );

  const buildPrompt = useCallback(
    (text: string) =>
      `Generate exactly ONE add_component call (no set_dashboard_meta). ` +
      `If the requested table or column doesn't exist on this source, call ` +
      `suggest_components with alternatives instead. The user wants: ${text}`,
    [],
  );

  const handleToolCall = useCallback(
    (call: DashboardToolCall, ctx: { abort: () => void }) => {
      if (call.tool !== 'add_component') return;
      onToolCall(call);
      ctx.abort();
    },
    [onToolCall],
  );

  const picker =
    readyDataSources.length > 1 ? (
      <div>
        <div className='block text-[12px] font-medium text-xyne-gray-500 mb-1.5'>Data source</div>
        <Select
          trackName='data-source-picker'
          value={dataSourceId}
          onChange={setDataSourceId}
          options={readyDataSources.map(d => ({ value: d.id, label: d.name }))}
          placeholder='Select a data source…'
          className='w-full'
        />
      </div>
    ) : undefined;

  return (
    <DashboardAiChat
      dataSourceId={dataSourceId || null}
      buildPrompt={buildPrompt}
      onToolCall={handleToolCall}
      emptyStatePrompt='What kind of chart would you like to create?'
      contextChips={[
        {
          icon: <LayoutDashboard size={11} className='text-xyne-gray-500' />,
          label: dashboardName,
          maxWidth: 120,
        },
      ]}
      {...(picker ? { dataSourcePicker: picker } : {})}
      lastError={lastError}
      trackCategory='component-editor'
      className='flex flex-col h-full'
    />
  );
};
