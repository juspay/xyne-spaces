import React, { ReactNode } from 'react';
import { BarchartDefault, FileText, GridDashboard01, SparkleAi02 } from '@xyne/icons';
import { Dialog, type DialogProps } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';

export type DeskInsightsSection = 'metrics' | 'topics' | 'report';

const SECTIONS = [
  {
    id: 'metrics',
    label: 'Metrics',
    description: 'Volume, response & SLAs',
    Icon: BarchartDefault,
  },
  {
    id: 'topics',
    label: 'Topics Explorer',
    description: 'What tickets are about',
    Icon: GridDashboard01,
  },
  { id: 'report', label: 'Desk Report', description: 'Generated desk summary', Icon: FileText },
] as const;

/** A desk insight panel's own dialog, or just its content when embedded in the Insights panel. */
export const DeskInsightsShell = ({
  embedded,
  ...dialogProps
}: DialogProps & { embedded?: boolean | undefined }): React.ReactElement =>
  embedded ? <>{dialogProps.children}</> : <Dialog {...dialogProps} />;

export interface DeskInsightsPanelProps {
  onClose: () => void;
  activeSection: DeskInsightsSection;
  availableSections: readonly DeskInsightsSection[];
  onSectionChange: (section: DeskInsightsSection) => void;
  children: ReactNode;
}

/** Single "Insights" side panel: a section sidebar with the active panel's card beside it. */
export const DeskInsightsPanel = ({
  onClose,
  activeSection,
  availableSections,
  onSectionChange,
  children,
}: DeskInsightsPanelProps): React.ReactElement => (
  <Dialog
    open
    onOpenChange={next => {
      if (!next) onClose();
    }}
    title='Insights'
    className={cn(
      'left-auto right-0 top-0 bottom-0 h-screen w-[85vw] max-h-none max-w-none translate-x-0 translate-y-0 rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
      'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
      'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
    )}
  >
    <div className='flex h-full w-full'>
      {/* The active panel's card overlaps the sidebar's right edge (pr-5 / -ml-4). */}
      <nav
        aria-label='Insights'
        className='flex w-56 shrink-0 flex-col rounded-l-[16px] border border-r-0 border-desk-border bg-muted pr-5 shadow-2xl dark:border-border'
      >
        <div className='flex items-center gap-2 px-3.5 py-3'>
          <span className='flex h-6 w-6 items-center justify-center rounded-[8px] bg-desk-accent/10 text-desk-accent'>
            <SparkleAi02 size={14} />
          </span>
          <span className='text-sm font-semibold text-foreground'>Insights</span>
        </div>
        <div className='flex flex-col gap-0.5 px-1.5'>
          {SECTIONS.filter(s => availableSections.includes(s.id)).map(
            ({ id, label, description, Icon }) => {
              const isActive = id === activeSection;
              return (
                <button
                  key={id}
                  type='button'
                  onClick={() => onSectionChange(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors',
                    isActive ? 'bg-background shadow-sm' : 'hover:bg-accent',
                  )}
                  data-track-category='Support'
                  data-track-name='SelectDeskInsightsSection'
                  data-track-metadata={JSON.stringify({ section: id })}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]',
                      isActive
                        ? 'bg-desk-accent/10 text-desk-accent'
                        : 'bg-background text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    <Icon size={14} />
                  </span>
                  <span className='min-w-0'>
                    <span className='block truncate text-[13px] font-medium text-foreground'>
                      {label}
                    </span>
                    <span className='block truncate text-[11px] text-muted-foreground'>
                      {description}
                    </span>
                  </span>
                </button>
              );
            },
          )}
        </div>
      </nav>
      <div className='relative -ml-4 min-w-0 flex-1'>{children}</div>
    </div>
  </Dialog>
);
