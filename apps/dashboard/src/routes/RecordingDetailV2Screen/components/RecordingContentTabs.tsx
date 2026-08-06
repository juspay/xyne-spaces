/**
 * Segmented control for the recording's content panes.
 *
 * The second segment is the transcript while the recording is live and the summary
 * once it has ended, so the same control serves both states. The active pill is a
 * single shared element animated between segments via `layoutId`, which keeps the
 * movement continuous instead of cross-fading two backgrounds.
 *
 * The summary segment doubles as a summary-template picker, so regenerating under a
 * different template is one click from the tab you are already on — which is why the
 * template props hang off this control rather than sitting beside it. The segment
 * reads as a plain tab until it is the open pane, and only then reveals its chevron
 * and opens the picker on click.
 */

import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CaptionOn } from '@xyne/icons';
import { AlignLeft, Check, ChevronDown } from 'lucide-react';
import { Popover } from '../../../components/ui/Popover';
import type { BuiltinRecordingSummaryTemplateId } from '../../../services/Recording/recordingService';
import { cn } from '../../../utils/classNames';
import { XyneAIStar } from '@/components/icons/xyne-ai';

export type RecordingContentTab = 'notes' | 'transcript' | 'summary';

export interface RecordingSummaryTemplate {
  id: BuiltinRecordingSummaryTemplateId;
  name: string;
  icon: string;
}

interface RecordingContentTabsProps {
  visibleTab: RecordingContentTab;
  /** `transcript` while live, `summary` once ended. */
  secondTab: Exclude<RecordingContentTab, 'notes'>;
  onSelect: (tab: RecordingContentTab) => void;
  /**
   * Summary templates offered on the summary segment. Omit to render a plain
   * "Default summary" pill with no menu.
   */
  templates?: ReadonlyArray<RecordingSummaryTemplate>;
  /** The template the current summary was generated with; labels the segment. */
  selectedTemplate?: RecordingSummaryTemplate;
  /** Swaps the segment's icon for a spinner and locks the menu while regenerating. */
  isRegenerating?: boolean;
  onTemplateSelect?: (templateId: BuiltinRecordingSummaryTemplateId) => void;
}

const TAB_INDICATOR_ID = 'recording-content-tab-indicator';

const MIDNIGHT_LISTBOX_RESET =
  '[[data-theme=midnight]_&[role=listbox]:not([cmdk-list])]:!bg-transparent';

const MIDNIGHT_OPTION_RESET = cn(
  '[[data-theme=midnight]_&[role=option]:not([cmdk-item])]:!text-foreground',
);

export const RecordingContentTabs = ({
  visibleTab,
  secondTab,
  onSelect,
  templates,
  selectedTemplate,
  isRegenerating = false,
  onTemplateSelect,
}: RecordingContentTabsProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);

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
    const label = selectedTemplate?.name ?? 'Default summary';

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

    const icon =
      selectedTemplate && selectedTemplate.id !== 'default' ? (
        <span aria-hidden='true' className='leading-none'>
          {selectedTemplate.icon}
        </span>
      ) : (
        <XyneAIStar size={12} />
      );

    if (!templates || !onTemplateSelect) {
      return (
        <button
          type='button'
          role='tab'
          aria-selected={isActive}
          onClick={() => onSelect('summary')}
          data-track-category='RecordingDetailV2'
          data-track-name='open_default_summary'
          className={cn(
            'relative inline-flex h-8 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {indicator}
          <span className='relative z-10 flex items-center gap-2'>
            {icon}
            {label}
          </span>
        </button>
      );
    }

    const handleOpenChange = (open: boolean): void => {
      if (!open) {
        setIsTemplateMenuOpen(false);
        return;
      }
      if (!isActive) {
        onSelect('summary');
        return;
      }
      if (!isRegenerating) setIsTemplateMenuOpen(true);
    };

    const handleTemplateSelect = (templateId: BuiltinRecordingSummaryTemplateId): void => {
      setIsTemplateMenuOpen(false);
      onTemplateSelect(templateId);
    };

    return (
      <Popover
        open={isTemplateMenuOpen}
        onOpenChange={handleOpenChange}
        side='bottom'
        align='start'
        sideOffset={6}
        className='w-64 rounded-xl border-border p-1.5 shadow-xl'
        trigger={
          <button
            type='button'
            role='tab'
            aria-selected={isActive}
            aria-busy={isRegenerating}
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
              {label}
              {/* The chevron belongs to the open pane only — off the summary the segment
                  is a plain tab, and advertising a menu there would promise the wrong
                  outcome for a click. Widening as it fades stops the label jumping. */}
              <AnimatePresence initial={false}>
                {isActive && (
                  <motion.span
                    initial={
                      shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }
                    }
                    animate={{ opacity: 1, scale: 1, width: 14 }}
                    exit={
                      shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }
                    }
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.16,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className='flex shrink-0 items-center justify-center overflow-hidden'
                    aria-hidden='true'
                  >
                    <motion.span
                      className='flex'
                      animate={{ rotate: isTemplateMenuOpen ? 180 : 0 }}
                      transition={{
                        duration: shouldReduceMotion ? 0 : 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <ChevronDown className='size-3.5' />
                    </motion.span>
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </button>
        }
      >
        <div
          role='listbox'
          aria-label='Summary templates'
          className={cn('thin-scrollbar', MIDNIGHT_LISTBOX_RESET)}
        >
          {templates.map(template => {
            const isSelected = template.id === selectedTemplate?.id;

            return (
              <button
                key={template.id}
                type='button'
                role='option'
                aria-selected={isSelected}
                onClick={() => handleTemplateSelect(template.id)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent',
                  MIDNIGHT_OPTION_RESET,
                  isSelected && 'bg-accent',
                )}
                data-track-category='RecordingDetailV2'
                data-track-name={`generate_summary_${template.id}`}
              >
                <span aria-hidden='true'>{template.icon}</span>
                <span className='min-w-0 flex-1 truncate'>{template.name}</span>
                {isSelected && (
                  <Check className='size-3.5 shrink-0 text-primary' aria-hidden='true' />
                )}
              </button>
            );
          })}
        </div>
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
        <AlignLeft className='size-4' aria-hidden='true' />,
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
