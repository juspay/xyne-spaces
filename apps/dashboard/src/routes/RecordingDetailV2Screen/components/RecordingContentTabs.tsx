/**
 * Segmented control for the recording's content panes.
 *
 * The second segment is the transcript while the recording is live and the summary
 * once it has ended, so the same control serves both states. The active pill is a
 * single shared element animated between segments via `layoutId`, which keeps the
 * movement continuous instead of cross-fading two backgrounds.
 *
 * The summary segment doubles as the summary-template picker: it is labelled with
 * the template currently applied and opens the template menu, so regenerating under
 * a different template is one click from the tab you are already on. That is why the
 * template props hang off this control rather than sitting beside it.
 */

import type { ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CaptionOn, Spinner } from '@xyne/icons';
import { AlignLeft, Check, ChevronDown, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import type { BuiltinRecordingSummaryTemplateId } from '../../../services/Recording/recordingService';
import { cn } from '../../../utils/classNames';

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
   * With templates supplied the segment is also the menu trigger: clicking selects
   * the summary tab (the button's own onClick) and opens the picker (Radix), so a
   * template chosen from another tab lands you on the summary it just generated.
   */
  const renderSummaryTab = (): ReactElement => {
    const summaryTab = renderTab(
      'summary',
      selectedTemplate?.name ?? 'Default summary',
      isRegenerating ? (
        <Spinner size={14} className='animate-spin text-orange-500' />
      ) : (
        <Sparkles className='size-4 text-orange-500' aria-hidden='true' />
      ),
      templates ? 'open_summary_templates' : 'open_default_summary',
      templates
        ? {
            trailing: <ChevronDown className='size-3.5' aria-hidden='true' />,
            disabled: isRegenerating,
          }
        : undefined,
    );

    if (!templates || !onTemplateSelect) return summaryTab;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{summaryTab}</DropdownMenuTrigger>
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
