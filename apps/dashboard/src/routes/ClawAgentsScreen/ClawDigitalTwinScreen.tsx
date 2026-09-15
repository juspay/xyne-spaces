import { ReactElement, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Brain,
  ClipboardList,
  Flame,
  Network,
  Power,
  RefreshCw,
  Search,
  Settings,
  Upload,
} from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawDigitalTwinStatus } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinBanner } from '@/components/ClawAgents/digitalTwin/DigitalTwinBanner';
import { DigitalTwinEnablePanel } from '@/components/ClawAgents/digitalTwin/DigitalTwinEnablePanel';
import type { DigitalTwinStatus } from '@/services/claw/digitalTwinTypes';
import { EnableModal } from '@/components/ClawAgents/digitalTwin/EnableModal';
import { DisableModal } from '@/components/ClawAgents/digitalTwin/DisableModal';
import { UploadModal } from '@/components/ClawAgents/digitalTwin/UploadModal';

// Primary sections + the Metrics view (grouped below a divider, mirroring how
// the agent-detail left nav separates Activity).
const SECTIONS = [
  { to: '/claw-agents/digital-twin', label: 'Memories', icon: Brain, end: true },
  { to: '/claw-agents/digital-twin/hot', label: 'Hot', icon: Flame, end: false },
  {
    to: '/claw-agents/digital-twin/proposals',
    label: 'Proposals',
    icon: ClipboardList,
    end: false,
  },
  { to: '/claw-agents/digital-twin/recall', label: 'Recall', icon: Search, end: false },
  { to: '/claw-agents/digital-twin/graph', label: 'Graph', icon: Network, end: false },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
    isActive
      ? 'bg-muted font-medium text-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

const HeaderButton = ({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon: typeof Settings;
  label: string;
  danger?: boolean;
}): ReactElement => {
  const IconComponent = icon;
  return (
    <Tooltip side='bottom' content={label}>
      <button
        type='button'
        onClick={onClick}
        data-track-category='Claw Agents'
        data-track-name={`Digital Twin ${label}`}
        aria-label={label}
        className={cn(
          'flex size-8 items-center justify-center rounded-lg border transition-colors',
          danger
            ? 'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10'
            : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <IconComponent className='size-4' />
      </button>
    </Tooltip>
  );
};

/** Subtle steady-state indicator in the header — detail lives in the tooltip. */
const StatusChip = ({
  status,
  backfillRunning,
  backfillStalled,
}: {
  status: DigitalTwinStatus;
  backfillRunning: boolean;
  backfillStalled: boolean;
}): ReactElement => {
  const label = backfillRunning ? (backfillStalled ? 'Stalled' : 'Backfilling') : 'Active';
  const dotClass = backfillRunning
    ? backfillStalled
      ? 'bg-amber-500'
      : 'bg-amber-500 animate-pulse'
    : 'bg-emerald-500';

  let detail: string;
  if (backfillRunning) {
    detail = backfillStalled
      ? 'Backfill stalled — no progress recently.'
      : 'Backfilling your Spaces history…';
  } else {
    const parts: string[] = [];
    if (status.pendingCandidates > 0) parts.push(`${status.pendingCandidates} pending review`);
    if (status.approvedCandidates > 0) parts.push(`${status.approvedCandidates} approved`);
    if (status.mdFileCount > 0)
      parts.push(`${status.mdFileCount} uploaded file${status.mdFileCount === 1 ? '' : 's'}`);
    detail = parts.length ? parts.join(' · ') : 'No memories yet — run a backfill or upload a .md.';
  }

  return (
    <Tooltip side='bottom' content={detail}>
      <span className='inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
        <span className={cn('size-1.5 rounded-full', dotClass)} />
        {label}
      </span>
    </Tooltip>
  );
};

const ClawDigitalTwinScreen = (): ReactElement => {
  const { data: status, isLoading, backfillStalled } = useClawDigitalTwinStatus();

  const [showBackfill, setShowBackfill] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const enabled = !!status?.enabled;
  const loadingFirst = isLoading && !status;
  const backfillRunning = !!(
    status?.backfillState && Object.values(status.backfillState).some(s => !s.complete)
  );

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: section nav — only meaningful once the Twin is enabled. */}
        {enabled && (
          <div className='sticky top-0 hidden w-44 shrink-0 flex-col self-start md:flex'>
            {/* Spacer aligning the nav with the right-side header. */}
            <div className='flex items-center border-b border-transparent pt-4 pb-4' aria-hidden>
              <span className='text-sm font-semibold leading-7'>&nbsp;</span>
            </div>
            <nav className='flex flex-col gap-1 pt-6'>
              {SECTIONS.map(section => {
                const IconComponent = section.icon;
                return (
                  <NavLink
                    key={section.to}
                    to={section.to}
                    end={section.end}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin Nav Section'
                    className={navLinkClass}
                  >
                    <IconComponent className='size-4 shrink-0' />
                    {section.label}
                  </NavLink>
                );
              })}
              <div className='my-2 border-t border-border' />
              <NavLink
                to='/claw-agents/digital-twin/metrics'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin Nav Metrics'
                className={navLinkClass}
              >
                <BarChart3 className='size-4 shrink-0' />
                Metrics
              </NavLink>
              <NavLink
                to='/claw-agents/digital-twin/settings'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin Nav Settings'
                className={navLinkClass}
              >
                <Settings className='size-4 shrink-0' />
                Settings
              </NavLink>
            </nav>
          </div>
        )}

        {/* Right: header action bar + status-dependent body. */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='flex items-center justify-between gap-4 border-b border-border pt-4 pb-4'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2.5'>
                <h1 className='text-lg font-semibold text-foreground'>Digital Twin</h1>
                {enabled && status && (
                  <StatusChip
                    status={status}
                    backfillRunning={backfillRunning}
                    backfillStalled={backfillStalled}
                  />
                )}
              </div>
              <p className='truncate text-xs text-muted-foreground'>
                Learns from your work, speaks in your voice — every memory approved by you
              </p>
            </div>
            {enabled && (
              <div className='flex shrink-0 items-center gap-2'>
                <HeaderButton
                  onClick={() => setShowBackfill(true)}
                  icon={RefreshCw}
                  label='Backfill history'
                />
                <HeaderButton
                  onClick={() => setShowUpload(true)}
                  icon={Upload}
                  label='Upload markdown'
                />
                <HeaderButton
                  onClick={() => setShowDisable(true)}
                  icon={Power}
                  label='Disable Twin'
                  danger
                />
              </div>
            )}
          </div>

          {loadingFirst ? (
            <div className='flex flex-col gap-4 pt-6'>
              <Skeleton className='h-20 w-full rounded-xl' />
              <Skeleton className='h-64 w-full rounded-xl' />
            </div>
          ) : enabled ? (
            <>
              {/* Rich banner only for the transient backfill progress; the
                  steady "active" state is shown as a header chip instead. */}
              {backfillRunning && (
                <div className='pt-6'>
                  <DigitalTwinBanner
                    status={status}
                    loading={isLoading}
                    backfillStalled={backfillStalled}
                    onEnable={() => undefined}
                    onDisable={() => setShowDisable(true)}
                  />
                </div>
              )}
              <div className='pt-6'>
                <Outlet />
              </div>
            </>
          ) : (
            <div className='pt-6'>
              <DigitalTwinEnablePanel />
            </div>
          )}
        </div>
      </div>

      {/* Modals — backfill is a header action while enabled; enable is in-page. */}
      <EnableModal open={showBackfill} mode='backfill' onClose={() => setShowBackfill(false)} />
      <DisableModal open={showDisable} onClose={() => setShowDisable(false)} />
      <UploadModal open={showUpload} onClose={() => setShowUpload(false)} />
    </div>
  );
};

export default ClawDigitalTwinScreen;
