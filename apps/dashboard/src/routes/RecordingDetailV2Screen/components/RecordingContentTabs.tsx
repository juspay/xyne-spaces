/**
 * Segmented control for the recording's content panes.
 *
 * The second segment is the transcript while the recording is live and the summary
 * once it has ended, so the same control serves both states. The active pill is a
 * single shared element animated between segments via `layoutId`, which keeps the
 * movement continuous instead of cross-fading two backgrounds.
 *
 * The summary segment doubles as a summary-template picker. Selecting a different
 * template regenerates immediately; the refresh action reruns the currently selected
 * template. The segment reads as a plain tab until it is the open pane, and only then
 * reveals its chevron and opens the picker on click.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Refresh,
  CaptionOn,
  CheckTickSingle,
  GridDashboardBento,
  Hashtag,
  PlusDefault,
  ChevronBigDown,
  ListAiGenerated,
} from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { XyneAIStar } from '@/components/icons/xyne-ai';
import { Popover } from '../../../components/ui/Popover';

export type RecordingContentTab = 'notes' | 'transcript' | 'summary';

export interface RecordingSummaryTemplate {
  id: string;
  name: string;
  icon: string;
}

interface RecordingContentTabsProps {
  visibleTab: RecordingContentTab;
  /** `transcript` while live, `summary` once ended. */
  secondTab: Exclude<RecordingContentTab, 'notes'>;
  onSelect: (tab: RecordingContentTab) => void;
  hasSummary: boolean;
  /** The template selected for this recording; labels the segment. */
  selectedTemplate?: RecordingSummaryTemplate;
  /** Swaps the segment's icon for a spinner and locks the menu while regenerating. */
  isRegenerating?: boolean;
  templates?: RecordingSummaryTemplate[];
  templatesLoading?: boolean;
  onTemplateMenuOpen?: () => void;
  onTemplateSelect?: (templateId: string) => void;
  onRegenerate?: () => void;
  onOpenTemplates?: () => void;
  onNewTemplate?: () => void;
}

const TAB_INDICATOR_ID = 'recording-content-tab-indicator';
const TEMPLATE_NAME_MAX_LENGTH = 24;

const truncateTemplateName = (name: string): string =>
  name.length > TEMPLATE_NAME_MAX_LENGTH
    ? `${name.slice(0, TEMPLATE_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;

export const RecordingContentTabs = ({
  visibleTab,
  secondTab,
  onSelect,
  hasSummary,
  selectedTemplate,
  isRegenerating = false,
  templates = [],
  templatesLoading = false,
  onTemplateMenuOpen,
  onTemplateSelect,
  onRegenerate,
  onOpenTemplates,
  onNewTemplate,
}: RecordingContentTabsProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);

  useEffect(() => {
    if (visibleTab !== 'summary' || isRegenerating) setIsTemplateMenuOpen(false);
  }, [isRegenerating, visibleTab]);

  const renderTab = (
    tab: RecordingContentTab,
    label: string,
    icon: ReactElement,
    trackName: string,
    options?: { trailing?: ReactElement; disabled?: boolean },
  ): ReactElement => {
    const isActive = visibleTab === tab;

    return (
      <button
        type='button'
        role='tab'
        aria-selected={isActive}
        onClick={() => onSelect(tab)}
        disabled={options?.disabled ?? false}
        data-track-category='RecordingDetailV2'
        data-track-name={trackName}
        className={cn(
          'relative inline-flex h-8 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {isActive && (
          <motion.span
            layoutId={TAB_INDICATOR_ID}
            className='absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60'
            transition={
              shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }
            }
            aria-hidden='true'
          />
        )}
        <span className='relative z-10 flex items-center gap-2'>
          {icon}
          {label}
          {options?.trailing}
        </span>
      </button>
    );
  };

  const renderSummaryTab = (): ReactElement => {
    const isActive = visibleTab === 'summary';
    const fullLabel = hasSummary ? (selectedTemplate?.name ?? 'Default summary') : 'Summary';
    const label = truncateTemplateName(fullLabel);

    const indicator = isActive ? (
      <motion.span
        layoutId={TAB_INDICATOR_ID}
        className='absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60'
        transition={
          shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }
        }
        aria-hidden='true'
      />
    ) : null;

    const hasCustomIcon = Boolean(selectedTemplate && selectedTemplate.name !== 'Default summary');

    const icon = hasCustomIcon ? (
      <Hashtag className='size-3.5' aria-hidden='true' />
    ) : (
      <XyneAIStar size={12} />
    );

    /** The menu header sits at the list's icon scale rather than the tab's. */
    const menuIcon = hasCustomIcon ? (
      <span aria-hidden='true' className='leading-none'>
        {selectedTemplate?.icon}
      </span>
    ) : (
      <XyneAIStar size={14} />
    );

    const trigger = (
      <button
        type='button'
        role='tab'
        aria-selected={isActive}
        aria-busy={isRegenerating}
        onClick={() => {
          if (!isActive) {
            onSelect('summary');
          }
        }}
        title={fullLabel}
        data-track-category='RecordingDetailV2'
        data-track-name='open_summary_templates'
        className={cn(
          'relative inline-flex h-8 items-center gap-2 rounded-full pl-5 pr-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          isRegenerating && 'cursor-wait',
        )}
      >
        {indicator}
        <span className='relative z-10 flex items-center gap-2'>
          {icon}
          <AnimatePresence mode='popLayout' initial={false}>
            <motion.span
              key={label}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.14 }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {isActive && onOpenTemplates && hasSummary && (
              <motion.span
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 14 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
                className='flex shrink-0 items-center justify-center overflow-hidden'
                aria-hidden='true'
              >
                <ChevronBigDown strokeWidth={2} className='size-3.5' />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>
    );

    if (!onOpenTemplates || !hasSummary) return trigger;

    return (
      <Popover
        trigger={trigger}
        open={isActive && isTemplateMenuOpen}
        onOpenChange={open => {
          if (isActive && !isRegenerating) {
            if (open) onTemplateMenuOpen?.();
            setIsTemplateMenuOpen(open);
          }
        }}
        side='bottom'
        align='start'
        sideOffset={8}
        className='w-60 rounded-xl border-border p-1.5 shadow-xl'
      >
        <div className='flex items-center gap-0.5 rounded-lg p-0.5'>
          <span className='flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-semibold text-foreground'>
            <span className='flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold shadow-sm'>
              {menuIcon}
            </span>
            <span className='min-w-0 flex-1 truncate' title={fullLabel}>
              {label}
            </span>
          </span>
          <button
            type='button'
            disabled={isRegenerating || !selectedTemplate?.id}
            onClick={() => {
              setIsTemplateMenuOpen(false);
              onRegenerate?.();
            }}
            aria-label={`Regenerate with ${fullLabel}`}
            className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
            data-track-category='RecordingDetailV2'
            data-track-name='regenerate_selected_summary_template'
          >
            <Refresh strokeWidth={2.5} className={cn('size-4', isRegenerating && 'animate-spin')} />
          </button>
          <span className='flex w-5 shrink-0 items-center justify-center'>
            <CheckTickSingle
              strokeWidth={2.5}
              className='size-4 text-status-success'
              aria-label='Selected template'
            />
          </span>
        </div>

        <div className='mx-1.5 my-1.5 h-px bg-border' />
        <p className='px-2.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          Templates
        </p>
        <div className='thin-scrollbar max-h-72 overflow-y-auto'>
          {templatesLoading ? (
            <p className='px-2.5 py-1.5 text-sm text-muted-foreground'>Loading templates…</p>
          ) : (
            templates
              .filter(template => template.id !== selectedTemplate?.id)
              .map(template => (
                <button
                  key={template.id}
                  type='button'
                  onClick={() => {
                    setIsTemplateMenuOpen(false);
                    onTemplateSelect?.(template.id);
                  }}
                  title={template.name}
                  className='flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
                  data-track-category='RecordingDetailV2'
                  data-track-name='select_summary_template'
                >
                  <span className='flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold shadow-sm'>
                    {template.icon}
                  </span>
                  <span className='min-w-0 flex-1 truncate'>
                    {truncateTemplateName(template.name)}
                  </span>
                </button>
              ))
          )}
        </div>

        <div className='mx-1.5 my-1.5 h-px bg-border' />
        <button
          type='button'
          onClick={() => {
            setIsTemplateMenuOpen(false);
            onOpenTemplates();
          }}
          className='flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
          data-track-category='RecordingDetailV2'
          data-track-name='open_all_summary_templates'
        >
          <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground'>
            <GridDashboardBento strokeWidth={2} className='size-4' />
          </span>
          All templates…
        </button>
        <button
          type='button'
          onClick={() => {
            setIsTemplateMenuOpen(false);
            onNewTemplate?.();
          }}
          className='flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
          data-track-category='RecordingDetailV2'
          data-track-name='new_summary_template'
        >
          <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground'>
            <PlusDefault className='size-4' />
          </span>
          New template
        </button>
      </Popover>
    );
  };

  return (
    <div
      role='tablist'
      aria-label='Recording content'
      className='inline-flex items-center gap-1 rounded-full bg-muted/60 p-1'
    >
      {renderTab(
        'notes',
        'My notes',
        <ListAiGenerated className='size-4' aria-hidden='true' />,
        'open_notes',
      )}
      {secondTab === 'transcript'
        ? renderTab(
            'transcript',
            'Transcript',
            <CaptionOn className='size-4' aria-hidden='true' />,
            'open_live_transcript',
          )
        : renderSummaryTab()}
    </div>
  );
};

export default RecordingContentTabs;
