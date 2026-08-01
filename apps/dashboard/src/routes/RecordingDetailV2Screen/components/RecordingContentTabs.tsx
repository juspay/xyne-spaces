/**
 * Segmented control for the recording's content panes.
 *
 * The second segment is the transcript while the recording is live and the summary
 * once it has ended, so the same control serves both states. The active pill is a
 * single shared element animated between segments via `layoutId`, which keeps the
 * movement continuous instead of cross-fading two backgrounds.
 *
 * The summary segment pairs the tab with a summary-template picker: the tab body
 * switches panes, and a chevron at its trailing edge opens the template menu, so
 * regenerating under a different template is one click from the tab you are already
 * on. That is why the template props hang off this control rather than sitting beside
 * it.
 */

import type { ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CaptionOn, Spinner } from '@xyne/icons';
import { AlignLeft, Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
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

  /**
   * With templates supplied the segment is split into two targets: the tab body
   * switches to the summary pane (the primary action), and the trailing chevron
   * opens the template picker (the secondary action). Radix anchors the menu to the
   * chevron itself, so the two actions stop clobbering each other. The pill styling
   * and the animated indicator live on a wrapper around both buttons.
   */
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

    const icon = isRegenerating ? (
      <Spinner size={14} className='animate-spin text-orange-500' />
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

    return (
      <DropdownMenu>
        <div
          className={cn(
            'relative inline-flex h-8 items-center rounded-full pl-5 pr-1 text-sm font-medium transition-colors',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {indicator}
          <button
            type='button'
            role='tab'
            aria-selected={isActive}
            onClick={() => onSelect('summary')}
            disabled={isRegenerating}
            data-track-category='RecordingDetailV2'
            data-track-name='open_summary_templates'
            className='relative z-10 flex h-full items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70'
          >
            {icon}
            {label}
          </button>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='Change summary template'
              disabled={isRegenerating}
              className='relative z-10 ml-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70'
              data-track-category='RecordingDetailV2'
              data-track-name='open_summary_template_menu'
            >
              <ChevronDown className='size-3.5' aria-hidden='true' />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align='start' className='w-64'>
          {templates.map(template => (
            <DropdownMenuItem
              key={template.id}
              onSelect={() => onTemplateSelect(template.id)}
              disabled={isRegenerating}
              data-track-category='RecordingDetailV2'
              data-track-name={`generate_summary_${template.id}`}
            >
              <span aria-hidden='true'>{template.icon}</span>
              <span className='flex-1'>{template.name}</span>
              {template.id === selectedTemplate?.id ? (
                <Check className='size-3.5 text-primary' aria-hidden='true' />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
