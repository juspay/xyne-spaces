import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Refresh, Settings01 } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import {
  DateRangeFilter,
  REPORTING_PRESETS,
} from '@/components/ui/DateRangeFilter/DateRangeFilter';
import { CLAW_USAGE_KEY, useUsageOptions, useUsageSummary } from '@/hooks/useClawUsage';
import { cn } from '@/utils/classNames';
import {
  OwnUsageNote,
  METRIC_OPTIONS,
  PageHeader,
  TRACK,
  dayRange,
  toDay,
  useControlPanel,
  type ControlPanel,
  type Tab,
} from './controlPanelShared';
import { OverviewTab } from './OverviewTab';
import { BreakdownCard, ToolsCard } from './UsageTables';

const agoLabel = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'Updated just now';
  if (s < 60) return `Updated ${s}s ago`;
  if (s < 3600) return `Updated ${Math.floor(s / 60)}m ago`;
  return `Updated ${Math.floor(s / 3600)}h ago`;
};

const RefreshStatus = ({ updatedAt }: { updatedAt: number }): ReactElement => {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: [CLAW_USAGE_KEY] }) > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return (): void => window.clearInterval(id);
  }, []);
  return (
    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
      <span aria-live='polite'>
        {fetching ? 'Updating…' : updatedAt ? agoLabel(now - updatedAt) : ''}
      </span>
      <Button
        variant='outline'
        size='iconSm'
        aria-label='Refresh usage'
        title='Refresh'
        disabled={fetching}
        onClick={() => void queryClient.invalidateQueries({ queryKey: [CLAW_USAGE_KEY] })}
        data-track-category={TRACK}
        data-track-name='refresh'
      >
        <Refresh className={cn('size-4', fetching && 'animate-spin')} aria-hidden />
      </Button>
    </div>
  );
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'tools', label: 'Tools' },
];

const Toolbar = ({ cp }: { cp: ControlPanel }): ReactElement => {
  const { view, params, update } = cp;
  return (
    <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
      <div className='inline-flex h-8 items-center rounded-md border border-border px-1'>
        <DateRangeFilter
          dateRange={dayRange(params.from, params.to)}
          onChange={r =>
            update(
              r ? { from: toDay(r.startDate), to: toDay(r.endDate) } : { from: null, to: null },
            )
          }
          presets={REPORTING_PRESETS}
          showTime={false}
          clearable={false}
          className='border-0'
        />
      </div>
      <SegmentedToggle
        options={METRIC_OPTIONS}
        value={view.metric}
        onChange={metric => update({ metric })}
        trackCategory={TRACK}
        trackPrefix='metric'
      />
    </div>
  );
};

const ControlPanelScreen = (): ReactElement => {
  const cp = useControlPanel();
  const navigate = useNavigate();
  const summary = useUsageSummary(cp.params);
  const options = useUsageOptions(cp.params);
  const isAdmin = summary.data?.scope.isAdmin ?? false;
  const tab = cp.view.tab;
  const openSettings = (): void =>
    void navigate('/ai/control-panel/settings', { state: { fromPanel: true } });

  return (
    <div className='mx-auto w-full max-w-7xl px-6 py-8'>
      <PageHeader
        title='Control panel'
        subtitle='AI usage and cost'
        note={summary.data?.scope.level === 'own' ? <OwnUsageNote /> : null}
        right={
          <div className='flex items-center gap-3'>
            <RefreshStatus updatedAt={summary.dataUpdatedAt} />
            {isAdmin && (
              <Button
                variant='outline'
                size='sm'
                onClick={openSettings}
                data-track-category={TRACK}
                data-track-name='open-settings'
              >
                <Settings01 className='size-3.5' aria-hidden />
                Settings
              </Button>
            )}
          </div>
        }
      />
      <Toolbar cp={cp} />
      <Tabs
        items={TABS}
        activeId={tab}
        onSelect={id => cp.update({ tab: id as Tab }, { push: true })}
        trackCategory={TRACK}
        trackPrefix='tab'
        idPrefix='control-panel'
        className='mb-5 border-b border-border pb-2'
      />
      <div
        role='tabpanel'
        id={`control-panel-panel-${tab}`}
        aria-labelledby={`control-panel-tab-${tab}`}
      >
        {tab === 'overview' && (
          <OverviewTab
            cp={cp}
            summary={summary}
            isAdmin={isAdmin}
            options={options.data}
            onOpenSettings={openSettings}
          />
        )}
        {tab === 'sessions' && (
          <BreakdownCard cp={cp} mode='sessions' isAdmin={isAdmin} options={options.data} />
        )}
        {tab === 'tools' && <ToolsCard cp={cp} options={options.data} />}
      </div>
    </div>
  );
};

export default ControlPanelScreen;
