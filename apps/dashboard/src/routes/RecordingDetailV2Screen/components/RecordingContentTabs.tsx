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

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CaptionOn, ChevronBigDown, ListAiGenerated, Spinner } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { Button } from '../../../components/ui/Button/Button';
import { Popover } from '../../../components/ui/Popover';
import {
  SummaryTemplateTourStep,
  isSummaryTemplateMenuStep,
  summaryTemplateTour,
  useSummaryTemplateTour,
} from '../../../components/SummaryTemplateTour';
import {
  SummaryTemplateGlyph,
  SummaryTemplateMenu,
} from '../../../components/SummaryTemplateMenu/SummaryTemplateMenu';
import type { SummaryTemplateOption } from '../../../components/SummaryTemplateMenu/SummaryTemplateMenu.types';
import {
  getSummaryTemplateLabel,
  truncateTemplateName,
} from '../../../components/SummaryTemplateMenu/SummaryTemplateMenu.utils';
import { Tooltip } from '../../../components/ui/Tooltip';

export type RecordingContentTab = 'notes' | 'transcript' | 'summary';

export type RecordingSummaryTemplate = SummaryTemplateOption;

interface RecordingContentTabsProps {
  visibleTab: RecordingContentTab;
  /** `transcript` while live, `summary` once ended. */
  secondTab: Exclude<RecordingContentTab, 'notes'>;
  onSelect: (tab: RecordingContentTab) => void;
  hasSummary: boolean;
  /** The template selected for this recording; labels the segment. */
  selectedTemplate?: RecordingSummaryTemplate;
  /** Adds a small busy indicator while a summary is regenerating. */
  isRegenerating?: boolean;
  /** Template currently being regenerated, which may differ from the rendered summary. */
  regeneratingTemplateId?: string;
  templates?: RecordingSummaryTemplate[];
  templatesLoading?: boolean;
  onTemplateMenuOpen?: () => void;
  onTemplateSelect?: (templateId: string) => void;
  onRegenerate?: () => void;
  onOpenTemplates?: () => void;
  onNewTemplate?: () => void;
  /** A one-time offer, after a template switch, to make that template the default. */
  defaultTemplateOffer?: { templateId: string; name: string } | null;
  onAcceptDefaultTemplateOffer?: () => void;
  onDismissDefaultTemplateOffer?: () => void;
}

const TAB_INDICATOR_ID = 'recording-content-tab-indicator';

export const RecordingContentTabs = ({
  visibleTab,
  secondTab,
  onSelect,
  hasSummary,
  selectedTemplate,
  isRegenerating = false,
  regeneratingTemplateId,
  templates = [],
  templatesLoading = false,
  onTemplateMenuOpen,
  onTemplateSelect,
  onRegenerate,
  onOpenTemplates,
  onNewTemplate,
  defaultTemplateOffer = null,
  onAcceptDefaultTemplateOffer,
  onDismissDefaultTemplateOffer,
}: RecordingContentTabsProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  // The template tour's first steps point into the dropdown, so it opens for them.
  const { activeStep: tourStep } = useSummaryTemplateTour();
  const isTourInMenu = isSummaryTemplateMenuStep(tourStep);
  useEffect(() => {
    if (isTourInMenu) setIsTemplateMenuOpen(true);
  }, [isTourInMenu]);
  // The offer popover anchors to the summary segment without being its trigger,
  // since the template menu already owns that role.
  const [summaryTrigger, setSummaryTrigger] = useState<HTMLButtonElement | null>(null);
  const offerAnchor = useMemo(
    () => (summaryTrigger ? { current: summaryTrigger } : undefined),
    [summaryTrigger],
  );
  const [hasInteracted, setHasInteracted] = useState(false);
  const pillTransition =
    shouldReduceMotion || !hasInteracted
      ? { duration: 0 }
      : { type: 'spring' as const, stiffness: 420, damping: 34 };

  useEffect(() => {
    if (visibleTab !== 'summary') setIsTemplateMenuOpen(false);
  }, [visibleTab]);

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
            transition={pillTransition}
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
    const fullLabel = hasSummary ? getSummaryTemplateLabel(selectedTemplate) : 'Summary';
    const label = truncateTemplateName(fullLabel);
    const regeneratingTemplate =
      templates.find(template => template.id === regeneratingTemplateId) ??
      (selectedTemplate?.id === regeneratingTemplateId ? selectedTemplate : undefined);
    const regeneratingTemplateLabel = regeneratingTemplate
      ? getSummaryTemplateLabel(regeneratingTemplate)
      : regeneratingTemplateId === 'default' || !regeneratingTemplateId
        ? getSummaryTemplateLabel(undefined)
        : 'selected template';
    const regeneratingTooltipContent = `Generating ${regeneratingTemplateLabel} summary`;

    const indicator = isActive ? (
      <motion.span
        layoutId={TAB_INDICATOR_ID}
        className='absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60'
        transition={pillTransition}
        aria-hidden='true'
      />
    ) : null;

    // The doc'd contract of `isRegenerating`: the segment's glyph becomes a
    // spinner while a generation runs, so the tab itself signals progress even
    // when the summary pane isn't the visible one.
    const icon = isRegenerating ? (
      <Spinner strokeWidth={2} className='size-4 animate-spin text-primary' aria-hidden='true' />
    ) : (
      <SummaryTemplateGlyph template={selectedTemplate} size='trigger' />
    );

    const trigger = (
      <button
        ref={setSummaryTrigger}
        type='button'
        role='tab'
        aria-selected={isActive}
        aria-busy={isRegenerating}
        onClick={() => {
          if (!isActive) {
            onSelect('summary');
          }
        }}
        title={isRegenerating ? regeneratingTooltipContent : fullLabel}
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
          {hasInteracted ? (
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
          ) : (
            <span>{label}</span>
          )}
          <AnimatePresence initial={false}>
            {isRegenerating && hasSummary && (
              <motion.span
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.14 }}
                className='flex shrink-0 items-center justify-center'
              >
                <Tooltip content={regeneratingTooltipContent} side='top'>
                  <span
                    className='flex size-3 items-center justify-center'
                    aria-label={regeneratingTooltipContent}
                  >
                    <Spinner size={12} className='animate-spin text-muted-foreground' />
                  </span>
                </Tooltip>
              </motion.span>
            )}
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

    const offer =
      defaultTemplateOffer && offerAnchor ? (
        <Popover
          trigger={<span aria-hidden className='hidden' />}
          anchor={offerAnchor}
          open={!isTemplateMenuOpen}
          onOpenChange={open => {
            if (!open) onDismissDefaultTemplateOffer?.();
          }}
          side='bottom'
          align='start'
          sideOffset={8}
          collisionPadding={12}
          showArrow
          onOpenAutoFocus={event => event.preventDefault()}
          // The template menu hands focus back to the tab as it closes, which lands
          // outside this popover; only a click elsewhere, Escape or a button closes it.
          onFocusOutside={event => event.preventDefault()}
          className='w-72 rounded-xl border-border p-3.5 shadow-xl'
        >
          <p className='text-sm font-semibold'>
            Use {defaultTemplateOffer.name} for future recordings?
          </p>
          <p className='mt-1 text-xs text-muted-foreground'>
            New recordings will be summarised with it. You can change this anytime in Preferences ›
            Recordings.
          </p>
          <div className='mt-3 flex items-center justify-end gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onDismissDefaultTemplateOffer?.()}
              className='text-muted-foreground'
              data-track-category='RecordingDetailV2'
              data-track-name='dismiss_default_template_offer'
            >
              Not now
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={() => onAcceptDefaultTemplateOffer?.()}
              data-track-category='RecordingDetailV2'
              data-track-name='accept_default_template_offer'
              data-track-metadata={JSON.stringify({ templateId: defaultTemplateOffer.templateId })}
            >
              Set as default
            </Button>
          </div>
        </Popover>
      ) : null;

    return (
      <>
        <Popover
          trigger={trigger}
          open={isActive && isTemplateMenuOpen}
          onOpenChange={open => {
            if (isActive) {
              if (open) onTemplateMenuOpen?.();
              // Closing the dropdown by hand ends a tour that was pointing into it.
              if (!open && isTourInMenu) summaryTemplateTour.dismiss();
              setIsTemplateMenuOpen(open);
            }
          }}
          side='bottom'
          align='start'
          sideOffset={8}
          className='w-60 rounded-xl border-border p-1.5 shadow-xl'
        >
          <SummaryTemplateMenu
            selectedTemplate={selectedTemplate}
            templates={templates}
            isLoading={templatesLoading}
            isRegenerating={isRegenerating}
            regeneratingTemplateId={regeneratingTemplateId}
            canRegenerate={Boolean(selectedTemplate?.id)}
            onSelectTemplate={templateId => onTemplateSelect?.(templateId)}
            onRegenerate={() => onRegenerate?.()}
            onOpenTemplates={onOpenTemplates}
            onNewTemplate={() => onNewTemplate?.()}
            onRequestClose={() => setIsTemplateMenuOpen(false)}
            trackCategory='RecordingDetailV2'
          />
          {/* Inside the dropdown's tree so clicking a coachmark does not close it. */}
          <SummaryTemplateTourStep
            step='pick-template'
            target='summary-template-menu-list'
            side='right'
            align='start'
          />
          <SummaryTemplateTourStep
            step='new-template'
            target='summary-template-menu-new'
            side='right'
            align='end'
            showBack
            onNext={() => {
              setIsTemplateMenuOpen(false);
              onNewTemplate?.();
              summaryTemplateTour.next();
            }}
          />
        </Popover>
        {offer}
      </>
    );
  };

  return (
    <div
      role='tablist'
      aria-label='Recording content'
      onClickCapture={() => setHasInteracted(true)}
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
