import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Refresh, StopCircle, UploadUp } from '@xyne/icons';
import { Button } from '@/components/ui/Button/index';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import Tooltip from '@/components/ui/Tooltip';
import { useClawDigitalTwinStatus } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinBanner } from './components/DigitalTwinBanner';
import { DigitalTwinEnablePanel } from './components/DigitalTwinEnablePanel';
import { EnableModal } from './components/EnableModal';
import { DisableModal } from './components/DisableModal';
import { UploadModal } from './components/UploadModal';
import type { DigitalTwinStatus } from '@/services/claw/digitalTwinTypes';
import DigitalTwinMemoriesTab from './tabs/DigitalTwinMemoriesTab';
import DigitalTwinHotTab from './tabs/DigitalTwinHotTab';
import DigitalTwinProposalsTab from './tabs/DigitalTwinProposalsTab';
import DigitalTwinRecallTab from './tabs/DigitalTwinRecallTab';
import DigitalTwinGraphTab from './tabs/DigitalTwinGraphTab';
import DigitalTwinSettingsTab from './tabs/DigitalTwinSettingsTab';
import DigitalTwinMetricsTab from './tabs/DigitalTwinMetricsTab';
import { Pill } from '../library/shared/primitives/Pill';
import { DIGITAL_TWIN_TABS, resolveDigitalTwinTab, type DigitalTwinTabId } from './digitalTwinTabs';

const TRACK_CATEGORY = 'Claw Digital Twin';

const statusDetail = (
  status: DigitalTwinStatus,
  backfillRunning: boolean,
  backfillStalled: boolean,
): string => {
  if (backfillRunning) {
    return backfillStalled
      ? 'Backfill stalled — no progress recently.'
      : 'Backfilling your Spaces history…';
  }
  const parts: string[] = [];
  if (status.pendingCandidates > 0) parts.push(`${status.pendingCandidates} pending review`);
  if (status.approvedCandidates > 0) parts.push(`${status.approvedCandidates} approved`);
  if (status.mdFileCount > 0)
    parts.push(`${status.mdFileCount} uploaded file${status.mdFileCount === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'No memories yet — run a backfill or upload a .md.';
};

const DigitalTwin = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveDigitalTwinTab(searchParams.get('tab'));

  const { data: status, isLoading, backfillStalled } = useClawDigitalTwinStatus();

  const [showBackfill, setShowBackfill] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const enabled = !!status?.enabled;
  const loadingFirst = isLoading && !status;
  const backfillRunning = !!(
    status?.backfillState && Object.values(status.backfillState).some(s => !s.complete)
  );

  const setActiveTab = (nextTab: DigitalTwinTabId): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className='max-w-ai-content mx-auto flex h-full min-h-0 w-full flex-col px-6'>
      <div className='bg-background flex shrink-0 flex-col'>
        <div className='flex flex-col justify-center gap-1 pt-5'>
          <div className='flex min-w-0 items-center gap-2'>
            <h1 className='truncate text-2xl font-semibold leading-tight tracking-tight text-foreground'>
              Digital Twin
            </h1>
            {enabled && status && (
              <Tooltip
                side='bottom'
                content={statusDetail(status, backfillRunning, backfillStalled)}
              >
                <span className='flex'>
                  <Pill tone={backfillRunning ? 'warning' : 'success'}>
                    {backfillRunning ? (backfillStalled ? 'Stalled' : 'Backfilling') : 'Active'}
                  </Pill>
                </span>
              </Tooltip>
            )}

            {enabled && (
              <div className='ml-auto flex shrink-0 items-center gap-1'>
                <Tooltip content='Backfill history' side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    onClick={() => setShowBackfill(true)}
                    aria-label='Backfill history'
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='Digital Twin: open backfill'
                    className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
                  >
                    <Refresh className='size-4' aria-hidden />
                  </Button>
                </Tooltip>
                <Tooltip content='Upload markdown' side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    onClick={() => setShowUpload(true)}
                    aria-label='Upload markdown'
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='Digital Twin: open upload'
                    className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
                  >
                    <UploadUp className='size-4' aria-hidden />
                  </Button>
                </Tooltip>
                <Tooltip content='Disable Twin' side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    onClick={() => setShowDisable(true)}
                    aria-label='Disable Twin'
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='Digital Twin: open disable'
                    className='text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-muted focus-visible:ring-0'
                  >
                    <StopCircle className='size-4' aria-hidden />
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
          <p className='text-sm leading-tight text-muted-foreground'>
            Learns how you work — you control what it remembers.
          </p>
        </div>

        {enabled && (
          <div className='mt-3 flex flex-col gap-3 pb-3 pt-2'>
            <Tabs
              items={DIGITAL_TWIN_TABS}
              activeId={activeTab}
              onSelect={id => setActiveTab(id as DigitalTwinTabId)}
              trackCategory={TRACK_CATEGORY}
              trackPrefix='Digital Twin tab'
            />
          </div>
        )}
      </div>

      {loadingFirst ? (
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-auto no-scrollbar pb-6'>
          <Skeleton className='h-20 w-full rounded-xl' />
          <Skeleton className='h-64 w-full rounded-xl' />
        </div>
      ) : enabled ? (
        <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-auto no-scrollbar pb-6'>
          {backfillRunning && (
            <DigitalTwinBanner
              status={status}
              loading={isLoading}
              backfillStalled={backfillStalled}
              onEnable={() => undefined}
              onDisable={() => setShowDisable(true)}
            />
          )}

          {activeTab === 'memories' && <DigitalTwinMemoriesTab />}
          {activeTab === 'hot' && <DigitalTwinHotTab />}
          {activeTab === 'proposals' && <DigitalTwinProposalsTab />}
          {activeTab === 'recall' && <DigitalTwinRecallTab />}
          {activeTab === 'graph' && <DigitalTwinGraphTab />}
          {activeTab === 'metrics' && <DigitalTwinMetricsTab />}
          {activeTab === 'settings' && <DigitalTwinSettingsTab />}
        </div>
      ) : (
        <div className='flex min-h-0 flex-1 flex-col overflow-auto no-scrollbar pb-6 pt-6'>
          <DigitalTwinEnablePanel />
        </div>
      )}

      <EnableModal open={showBackfill} mode='backfill' onClose={() => setShowBackfill(false)} />
      <DisableModal open={showDisable} onClose={() => setShowDisable(false)} />
      <UploadModal open={showUpload} onClose={() => setShowUpload(false)} />
    </div>
  );
};

export default DigitalTwin;
