/**
 * Summary-template pill for the call detail view: the tab pill is the trigger, the
 * menu inside is the shared `SummaryTemplateMenu`. The rewrite is owned by
 * `useCallSummaryRegeneration` on the screen — this is only the pill, which is also
 * the sole in-flight affordance, since the pane keeps showing the current summary
 * until the new one lands.
 */
import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronBigDown, Spinner } from '@xyne/icons';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  SummaryTemplateGlyph,
  SummaryTemplateMenu,
} from '../../components/SummaryTemplateMenu/SummaryTemplateMenu';
import type { SummaryTemplateOption } from '../../components/SummaryTemplateMenu/SummaryTemplateMenu.types';
import {
  DEFAULT_SUMMARY_TEMPLATE_NAME,
  getSummaryTemplateLabel,
  truncateTemplateName,
} from '../../components/SummaryTemplateMenu/SummaryTemplateMenu.utils';
import {
  SummaryTemplatesModal,
  getTemplateIcon,
} from '../RecordingDetailV2Screen/components/SummaryTemplatesModal';
import { useSummaryTemplates } from '../../hooks/useSummaryTemplates';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useSelf } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';

const DEFAULT_TEMPLATE_OPTION: SummaryTemplateOption = {
  id: 'default',
  name: DEFAULT_SUMMARY_TEMPLATE_NAME,
  icon: '✨',
};

interface CallSummaryTemplatePickerProps {
  /** Template the visible summary was written with, from useCallSummaryRegeneration. */
  selectedTemplateId?: string | null;
  /** True while a rewrite is in flight; swaps the glyph for a spinner. */
  isRegenerating: boolean;
  /** Template the running rewrite is producing, which differs from the rendered one. */
  regeneratingTemplateId?: string;
  /** Whether a summary exists to describe; gates the trailing busy indicator. */
  hasSummary: boolean;
  /** Starts a rewrite with the chosen template; the name is only for the toast. */
  onApplyTemplate: (templateId: string, templateName?: string) => void;
  /** True while the detailed summary is the visible pane. */
  isActive: boolean;
  /** Called when an inactive pill is clicked, to switch to the summary pane. */
  onSelect: () => void;
  /** Pill classes from the parent, so this matches the other tabs exactly. */
  className?: string;
}

export function CallSummaryTemplatePicker({
  selectedTemplateId,
  isRegenerating,
  regeneratingTemplateId,
  hasSummary,
  onApplyTemplate,
  isActive,
  onSelect,
  className,
}: CallSummaryTemplatePickerProps): ReactElement {
  const shouldReduceMotion = useReducedMotion();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [templatesModalMode, setTemplatesModalMode] = useState<'browse' | 'new' | null>(null);
  const [shouldLoadTemplates, setShouldLoadTemplates] = useState(false);
  const currentUser = useSelf();

  // A rewrite restored from a previous visit — or started by someone else — has an
  // id but no list to resolve it against, so the pill would say "selected template".
  // Load for it, as the recording screen does when rehydrating a marker.
  const needsRegeneratingTemplateName =
    isRegenerating &&
    !!regeneratingTemplateId &&
    regeneratingTemplateId !== DEFAULT_TEMPLATE_OPTION.id;

  const { templates, isLoading: templatesLoading } = useSummaryTemplates(
    shouldLoadTemplates || templatesModalMode !== null || needsRegeneratingTemplateName,
  );

  const templateOptions: SummaryTemplateOption[] = [
    DEFAULT_TEMPLATE_OPTION,
    ...templates
      .filter(template => template.id !== DEFAULT_TEMPLATE_OPTION.id)
      .map(template => ({
        id: template.id,
        name: template.name,
        icon: getTemplateIcon(template.name),
      })),
  ];

  // The list is only fetched once the menu opens, so on a fresh visit resolve the
  // applied id directly — otherwise the pill reads "Default summary". Same shape as
  // RecordingDetailV2Screen's storedSummaryTemplate. The default template is
  // code-backed with no row, so it is never queried.
  const storedTemplateId = selectedTemplateId ?? '';
  const shouldQueryStoredTemplate =
    storedTemplateId.length > 0 && storedTemplateId !== DEFAULT_TEMPLATE_OPTION.id;
  const [storedTemplate] = useCachedQuery(
    queries.summaryTemplateById({ templateId: storedTemplateId }),
    { enabled: shouldQueryStoredTemplate },
  );

  const selectedTemplate =
    templateOptions.find(template => template.id === selectedTemplateId) ??
    (storedTemplate?.id === storedTemplateId
      ? {
          id: storedTemplate.id,
          name: storedTemplate.name,
          icon: getTemplateIcon(storedTemplate.name),
        }
      : DEFAULT_TEMPLATE_OPTION);

  // Until a summary exists, naming a template would claim a document the call does
  // not have. RecordingContentTabs does the same.
  const fullLabel = hasSummary ? getSummaryTemplateLabel(selectedTemplate) : 'Summary';
  const label = truncateTemplateName(fullLabel);

  // With the list unfetched, a rewrite started before the menu opened has no name
  // to show — say "selected template" rather than naming the wrong one.
  const regeneratingTemplate =
    templateOptions.find(template => template.id === regeneratingTemplateId) ??
    (selectedTemplate.id === regeneratingTemplateId ? selectedTemplate : undefined);
  const regeneratingTemplateLabel = regeneratingTemplate
    ? getSummaryTemplateLabel(regeneratingTemplate)
    : regeneratingTemplateId === 'default' || !regeneratingTemplateId
      ? getSummaryTemplateLabel(undefined)
      : 'selected template';
  const regeneratingTooltipContent = `Generating ${regeneratingTemplateLabel} summary`;

  const trigger = (
    <button
      type='button'
      role='tab'
      aria-selected={isActive}
      onClick={() => {
        if (!isActive) onSelect();
      }}
      title={isRegenerating ? regeneratingTooltipContent : fullLabel}
      aria-busy={isRegenerating}
      data-track-category='CallDetail'
      data-track-name='open_summary_templates'
      className={cn('max-w-[200px]', isRegenerating && 'cursor-wait', className)}
    >
      {isRegenerating ? (
        <Spinner
          strokeWidth={2}
          className='size-4 shrink-0 animate-spin text-primary'
          aria-hidden='true'
        />
      ) : (
        <SummaryTemplateGlyph template={selectedTemplate} size='trigger' className='shrink-0' />
      )}
      <span className='truncate'>{label}</span>
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
      {isActive && hasSummary && (
        <ChevronBigDown strokeWidth={2} className='size-3.5 shrink-0' aria-hidden='true' />
      )}
    </button>
  );

  // Nothing to rewrite yet, so the pill is a plain tab with no menu — the pane's
  // SummaryGenerationPanel carries the offer instead, mirroring the recording
  // segment. The glyph still swaps to a spinner, so a first generation shows
  // progress on the tab exactly as a rewrite does.
  if (!hasSummary) return trigger;

  return (
    <>
      <Popover
        trigger={trigger}
        open={isActive && isMenuOpen}
        onOpenChange={open => {
          // Not gated on isRegenerating: a rewrite leaves the current summary
          // readable, so the menu stays browsable. It disables its own actions.
          if (!isActive) return;
          if (open) setShouldLoadTemplates(true);
          setIsMenuOpen(open);
        }}
        side='bottom'
        align='start'
        sideOffset={8}
        collisionPadding={12}
        className='w-60 rounded-xl border-border p-1.5 shadow-xl'
      >
        <SummaryTemplateMenu
          selectedTemplate={selectedTemplate}
          templates={templateOptions}
          isLoading={templatesLoading}
          isRegenerating={isRegenerating}
          {...(regeneratingTemplateId ? { regeneratingTemplateId } : {})}
          onSelectTemplate={templateId =>
            onApplyTemplate(
              templateId,
              templateOptions.find(template => template.id === templateId)?.name,
            )
          }
          onRegenerate={() => onApplyTemplate(selectedTemplate.id, selectedTemplate.name)}
          onOpenTemplates={() => setTemplatesModalMode('browse')}
          onNewTemplate={() => setTemplatesModalMode('new')}
          onRequestClose={() => setIsMenuOpen(false)}
          trackCategory='CallDetail'
        />
      </Popover>

      {currentUser && templatesModalMode && (
        <Dialog
          open={templatesModalMode !== null}
          onOpenChange={open => !open && setTemplatesModalMode(null)}
          title='Summary Templates'
          description='Choose, create, edit, and share a call summary template.'
          className='h-full max-h-[824px] w-full max-w-screen-lg overflow-hidden rounded-2xl p-0'
          testId='summary-templates-dialog'
        >
          <SummaryTemplatesModal
            templates={templates}
            loading={templatesLoading}
            selectedTemplateId={selectedTemplate.id}
            currentUserId={currentUser.id}
            currentUserName={getUserDisplayName(currentUser)}
            startWithNewTemplate={templatesModalMode === 'new'}
            onClose={() => setTemplatesModalMode(null)}
            onApply={template => {
              setTemplatesModalMode(null);
              onApplyTemplate(template.id, template.name);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
