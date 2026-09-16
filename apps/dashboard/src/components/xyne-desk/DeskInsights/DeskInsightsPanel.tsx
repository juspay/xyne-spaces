import React from 'react';
import {
  BarchartDefault as BarChart3,
  GridDashboard01,
  FileText,
  MultipleCrossCancelDefault as X,
} from '@xyne/icons';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { DESK_PANEL_DIALOG_CLASS } from './DeskPanelShell';
import { DeskMetricsDashboard, type DeskMetricsDashboardProps } from '../DeskMetrics';
import { TopicsExplorer, type TopicsExplorerProps } from '../TopicsExplorer';
import { DeskReportPanel } from '../DeskReport';

/**
 * The three desk insight surfaces, in the order they appear in the Insights
 * sidebar. Metrics first (the most-used), then Topics, then the Report.
 */
export const DESK_INSIGHTS_SECTIONS = ['metrics', 'topics', 'report'] as const;
export type DeskInsightsSection = (typeof DESK_INSIGHTS_SECTIONS)[number];

const SECTION_META: Record<
  DeskInsightsSection,
  { label: string; description: string; icon: React.ComponentType<{ size?: number }> }
> = {
  metrics: { label: 'Metrics', description: 'Volume, SLA and agent load', icon: BarChart3 },
  topics: { label: 'Topics Explorer', description: 'What tickets are about', icon: GridDashboard01 },
  report: { label: 'Desk Report', description: 'Scheduled written summary', icon: FileText },
};

export interface DeskInsightsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Sections the caller is allowed to show, already permission-filtered. */
  availableSections: readonly DeskInsightsSection[];
  activeSection: DeskInsightsSection;
  onSectionChange: (section: DeskInsightsSection) => void;
  channelId: string;
  channelName?: string;
  /** Desk base path (e.g. `/ws/support`), used for topic drill-through. */
  supportBase: string;
  // Metrics inputs
  availableDesks?: DeskMetricsDashboardProps['availableDesks'];
  customFieldDefinitions?: DeskMetricsDashboardProps['customFieldDefinitions'];
  availableStages?: DeskMetricsDashboardProps['availableStages'];
  onTicketClick: DeskMetricsDashboardProps['onTicketClick'];
  // Topics inputs
  availableAiCategories: TopicsExplorerProps['availableAiCategories'];
  topicsAvailableStages: TopicsExplorerProps['availableStages'];
}

/**
 * Single "Insights" sheet that hosts Desk Metrics, Topics Explorer and the Desk
 * Report behind one entry point. Each section keeps its own component, data
 * fetching and permissions — this only owns the shell and the section switch,
 * so only the active section is mounted (and therefore only it fetches).
 */
export const DeskInsightsPanel: React.FC<DeskInsightsPanelProps> = ({
  open,
  onClose,
  availableSections,
  activeSection,
  onSectionChange,
  channelId,
  channelName,
  supportBase,
  availableDesks,
  customFieldDefinitions,
  availableStages,
  onTicketClick,
  availableAiCategories,
  topicsAvailableStages,
}) => {
  const sections = DESK_INSIGHTS_SECTIONS.filter(s => availableSections.includes(s));
  // Guard against a URL asking for a section this user can't see.
  const section = sections.includes(activeSection) ? activeSection : sections[0];
  if (!section) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title='Insights'
      className={DESK_PANEL_DIALOG_CLASS}
    >
      <div className='relative h-full w-full'>
        <button
          type='button'
          onClick={onClose}
          className='absolute right-6 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-[10px] border border-desk-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
          aria-label='Close insights'
          data-track-category='DeskInsights'
          data-track-name='CloseButton'
        >
          <X size={16} />
        </button>
        <div className='isolate flex h-full w-full overflow-hidden rounded-l-[16px] border border-desk-border bg-popover shadow-2xl dark:border-border'>
          <nav
            aria-label='Insights sections'
            className='flex w-[220px] shrink-0 flex-col gap-1 border-r border-desk-border bg-muted/20 p-3 dark:border-border'
          >
            <p className='px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
              Insights
            </p>
            {sections.map(id => {
              const meta = SECTION_META[id];
              const Icon = meta.icon;
              const isActive = id === section;
              return (
                <button
                  key={id}
                  type='button'
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSectionChange(id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  data-track-category='DeskInsights'
                  data-track-name={`Section_${id}`}
                  data-track-metadata={JSON.stringify({ channelId })}
                >
                  <span className='mt-0.5 shrink-0'>
                    <Icon size={15} />
                  </span>
                  <span className='min-w-0'>
                    <span className='block truncate text-[13px] font-medium'>{meta.label}</span>
                    <span className='block text-[11px] leading-tight text-muted-foreground'>
                      {meta.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className='relative min-w-0 flex-1'>
            {section === 'metrics' && (
              <DeskMetricsDashboard
                embedded
                open={open}
                onClose={onClose}
                channelId={channelId}
                channelName={channelName}
                availableDesks={availableDesks}
                customFieldDefinitions={customFieldDefinitions}
                availableStages={availableStages}
                onTicketClick={onTicketClick}
              />
            )}
            {section === 'topics' && (
              <TopicsExplorer
                embedded
                open={open}
                onClose={onClose}
                channelId={channelId}
                channelName={channelName}
                supportBase={supportBase}
                availableAiCategories={availableAiCategories}
                availableStages={topicsAvailableStages}
              />
            )}
            {section === 'report' && (
              <DeskReportPanel
                embedded
                open={open}
                onClose={onClose}
                channelId={channelId}
                channelName={channelName}
              />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
