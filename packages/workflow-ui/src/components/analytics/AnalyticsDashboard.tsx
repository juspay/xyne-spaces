import { useState, useMemo } from 'react';
import { useAnalytics } from '../../hooks/use-analytics.js';
import type { AnalyticsRange } from '../../hooks/use-analytics.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { cn } from '../shared/cn.js';
import { StatCard } from './StatCard.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';
import { RunsTimeSeries } from './RunsTimeSeries.js';
import { StatusPieChart } from './StatusPieChart.js';
import { TopErrorsPanel } from './TopErrorsPanel.js';
import { RecentFailuresPanel } from './RecentFailuresPanel.js';
import { WorkflowsTable } from './WorkflowsTable.js';
import { WorkflowRunsPanel } from './WorkflowRunsPanel.js';
import { FilteredRunsPanel } from './FilteredRunsPanel.js';
import { ExecutionViewer } from '../execution/ExecutionViewer.js';
import { FolderGrid } from './FolderGrid.js';
import { useFolderList } from '../../hooks/use-folder-list.js';
import type { FolderRecord } from '@xyne/workflow-sdk/client';

export interface AnalyticsDashboardProps {
  className?: string;
}

type DrilldownView =
  | { level: 'workflows' }
  | { level: 'runs'; workflowId: string; workflowName: string }
  | { level: 'steps'; workflowId: string; workflowName: string; executionId: string };

type ActiveTab = 'overview' | 'folders';

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[var(--wui-border)] p-4',
        className,
      )}
      style={{ background: 'var(--wui-bg, #ffffff)' }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--wui-fg-muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Breadcrumb({
  view,
  onNavigate,
}: {
  view: DrilldownView;
  onNavigate: (view: DrilldownView) => void;
}) {
  const crumbs: Array<{ label: string; onClick?: (() => void) | undefined }> = [
    {
      label: 'Workflows',
      onClick: view.level !== 'workflows' ? () => onNavigate({ level: 'workflows' }) : undefined,
    },
  ];

  if (view.level === 'runs' || view.level === 'steps') {
    crumbs.push({
      label: view.workflowName,
      onClick:
        view.level === 'steps'
          ? () => onNavigate({ level: 'runs', workflowId: view.workflowId, workflowName: view.workflowName })
          : undefined,
    });
  }

  if (view.level === 'steps') {
    crumbs.push({ label: `Run ${view.executionId.slice(0, 8)}` });
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--wui-fg-muted)]">/</span>}
          {crumb.onClick ? (
            <button
              onClick={crumb.onClick}
              className="font-medium text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="font-semibold text-[var(--wui-fg)]">{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Overview (current dashboard content, optionally scoped to a folder) ───

interface AnalyticsOverviewProps {
  folderId?: string;
  folderName?: string;
  className?: string;
  onBack?: () => void;
}

function AnalyticsOverview({ folderId, folderName, className, onBack }: AnalyticsOverviewProps) {
  const [range, setRange] = useState<AnalyticsRange>(7);
  const [view, setView] = useState<DrilldownView>({ level: 'workflows' });
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<{ label: string; status: string } | { label: string } | null>(null);
  const [hasTopErrors, setHasTopErrors] = useState(true);
  const topErrorsSince = useMemo(
    () => new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString(),
    [range],
  );

  function handleRangeChange(r: AnalyticsRange) {
    setRange(r);
    setHasTopErrors(true);
  }

  function handleStatClick(label: string, status?: string) {
    setActiveFilter((prev) => {
      if (prev?.label === label) return null;
      return status ? { label, status } : { label };
    });
  }

  const { data, isLoading, error } = useAnalytics(range, folderId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" aria-label="Loading">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--wui-status-failed)]">
        Failed to load analytics
      </div>
    );
  }

  // Full-screen execution view
  if (view.level === 'steps') {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--wui-border)] px-4 py-2.5" style={{ background: 'var(--wui-bg, #ffffff)' }}>
          <button
            type="button"
            onClick={() => setView({ level: 'runs', workflowId: view.workflowId, workflowName: view.workflowName })}
            className="flex items-center gap-1.5 rounded-md border border-[var(--wui-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--wui-fg-muted)] transition-colors hover:border-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Analytics
          </button>
          <div className="flex items-center gap-1.5 text-xs text-[var(--wui-fg-muted)]">
            <span>{view.workflowName}</span>
            <span>/</span>
            <span className="font-mono font-medium text-[var(--wui-fg)]">{view.executionId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ExecutionViewer executionId={view.executionId} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 p-6', className)}>
      {/* Back button when scoped to a folder */}
      {onBack && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md border border-[var(--wui-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--wui-fg-muted)] transition-colors hover:border-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Folders
          </button>
          {folderName && (
            <span className="text-xs font-semibold text-[var(--wui-fg)]">{folderName}</span>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <TimeRangeSelector value={range} onChange={handleRangeChange} />
      </div>

      <div className="flex gap-3 overflow-x-auto">
        <StatCard label="Total Runs" value={data.totalRuns} color="var(--wui-primary)"
          active={activeFilter?.label === 'Total Runs'} onClick={() => handleStatClick('Total Runs', undefined)} />
        <StatCard label="Success Rate" value={data.successRate} percent color="var(--wui-status-completed)"
          active={activeFilter?.label === 'Success Rate'} onClick={() => handleStatClick('Success Rate', 'COMPLETED')} />
        <StatCard label="Failed" value={data.byStatus['FAILED'] ?? 0} color="var(--wui-status-failed)"
          active={activeFilter?.label === 'Failed'} onClick={() => handleStatClick('Failed', 'FAILED')} />
        <StatCard label="Running" value={data.byStatus['RUNNING'] ?? 0} color="var(--wui-status-running)"
          active={activeFilter?.label === 'Running'} onClick={() => handleStatClick('Running', 'RUNNING')} />
        <StatCard label="Waiting" value={data.byStatus['EXTERNAL_WAIT'] ?? 0} color="var(--wui-status-paused)"
          active={activeFilter?.label === 'Waiting'} onClick={() => handleStatClick('Waiting', 'EXTERNAL_WAIT')} />
        <StatCard label="Cancelled" value={data.byStatus['CANCELLED'] ?? 0} color="var(--wui-fg-muted)"
          active={activeFilter?.label === 'Cancelled'} onClick={() => handleStatClick('Cancelled', 'CANCELLED')} />
        <StatCard label="Active Workflows" value={data.activeWorkflows} total={data.totalWorkflows} color="var(--wui-cat-integration)" />
      </div>

      {activeFilter && (
        <FilteredRunsPanel
          label={activeFilter.label}
          {...('status' in activeFilter ? { status: activeFilter.status } : {})}
          {...(folderId !== undefined ? { folderId } : {})}
          onClose={() => setActiveFilter(null)}
          onSelectExecution={(executionId, workflowId) => {
            const wf = data.byWorkflow.find((w) => w.workflowId === workflowId);
            setActiveFilter(null);
            setView({ level: 'steps', workflowId, workflowName: wf?.name ?? workflowId, executionId });
          }}
        />
      )}

      <div className="flex gap-4">
        <SectionCard title="Runs per day" className="min-w-0 flex-1 overflow-hidden">
          <RunsTimeSeries data={data.runsByDay} height={200} />
        </SectionCard>
        <SectionCard title="Status breakdown" className="w-[280px] shrink-0">
          <StatusPieChart byStatus={data.byStatus} height={200} />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.recentFailures.length > 0 && (
          <SectionCard title="Recent Failures">
            <RecentFailuresPanel
              failures={data.recentFailures}
              onSelect={(f) =>
                setView({ level: 'steps', workflowId: f.workflowId, workflowName: f.workflowName, executionId: f.executionId })
              }
            />
          </SectionCard>
        )}
        <SectionCard title="Top Errors" className={hasTopErrors ? '' : 'hidden'}>
          <TopErrorsPanel
            since={topErrorsSince}
            {...(folderId !== undefined ? { folderId } : {})}
            onLoad={setHasTopErrors}
            onSelectRun={(executionId, workflowId) => {
              const wf = data.byWorkflow.find((w) => w.workflowId === workflowId);
              setView({ level: 'steps', workflowId, workflowName: wf?.name ?? workflowId, executionId });
            }}
          />
        </SectionCard>
      </div>

      <SectionCard title="Explore">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumb view={view} onNavigate={setView} />
          {view.level === 'workflows' && (
            <div className="relative w-full max-w-xs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--wui-fg-muted)]">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={workflowSearch}
                onChange={(e) => setWorkflowSearch(e.target.value)}
                placeholder="Search workflows..."
                className="w-full rounded-md border border-[var(--wui-border)] py-1.5 pl-8 pr-3 text-xs text-[var(--wui-fg)] outline-none transition-colors placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]"
                style={{ background: 'var(--wui-bg, #ffffff)' }}
              />
            </div>
          )}
        </div>
        {view.level === 'workflows' && (
          <WorkflowsTable
            data={data.byWorkflow}
            search={workflowSearch}
            onSelectWorkflow={(workflowId) => {
              const wf = data.byWorkflow.find((w) => w.workflowId === workflowId);
              setView({ level: 'runs', workflowId, workflowName: wf?.name ?? workflowId });
            }}
          />
        )}
        {view.level === 'runs' && (
          <WorkflowRunsPanel
            workflowId={view.workflowId}
            onSelectExecution={(executionId) =>
              setView({ level: 'steps', workflowId: view.workflowId, workflowName: view.workflowName, executionId })
            }
          />
        )}
      </SectionCard>
    </div>
  );
}

// ─── Tab shell (public export) ───

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'folders', label: 'Folders' },
];

export function AnalyticsDashboard({ className }: AnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [parentFolder, setParentFolder] = useState<FolderRecord | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<FolderRecord | null>(null);
  const { folders } = useFolderList();

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    setParentFolder(null);
    setSelectedFolder(null);
  }

  function handleParentSelect(folder: FolderRecord) {
    const hasSubFolders = folders.some((f) => (f.parentId ?? null) === folder.id);
    if (hasSubFolders) {
      setParentFolder(folder);
    } else {
      // No sub-folders — go straight to workflow analytics
      setSelectedFolder(folder);
    }
  }

  const showTabs = !parentFolder && !selectedFolder;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Tab bar — hidden when drilled into folders */}
      {showTabs && (
        <div className="flex shrink-0 border-b border-[var(--wui-border)] px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-b-2 border-[var(--wui-primary)] text-[var(--wui-fg)]'
                  : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <AnalyticsOverview />}

        {/* Level 1: top-level parent folders */}
        {activeTab === 'folders' && !parentFolder && !selectedFolder && (
          <div className="p-6">
            <FolderGrid parentId={null} onSelect={handleParentSelect} />
          </div>
        )}

        {/* Level 2: sub-folders inside the selected parent */}
        {activeTab === 'folders' && parentFolder && !selectedFolder && (
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setParentFolder(null)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--wui-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--wui-fg-muted)] transition-colors hover:border-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Folders
              </button>
              <span className="text-xs text-[var(--wui-fg-muted)]">/</span>
              <span className="text-xs font-semibold text-[var(--wui-fg)]">{parentFolder.name}</span>
            </div>
            <FolderGrid parentId={parentFolder.id} onSelect={setSelectedFolder} />
          </div>
        )}

        {/* Level 3: workflow analytics for the selected sub-folder (or direct folder) */}
        {activeTab === 'folders' && selectedFolder && (
          <AnalyticsOverview
            folderId={selectedFolder.id}
            folderName={parentFolder ? `${parentFolder.name} / ${selectedFolder.name}` : selectedFolder.name}
            onBack={() => setSelectedFolder(null)}
          />
        )}
      </div>
    </div>
  );
}
