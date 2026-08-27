/**
 * Summary-template pill for the call detail view: the tab pill is the trigger, the
 * menu inside is the shared `SummaryTemplateMenu`. The rewrite itself is owned by
 * `useCallSummaryRegeneration` on the screen, since the content pane swaps panels
 * for its duration — this renders only the pill half.
 */
import { useState, type ReactElement } from 'react';
import { ChevronBigDown } from '@xyne/icons';
import { Popover } from '../../components/ui/Popover';
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
  /** True while a rewrite is in flight; disables Regenerate and spins its icon. */
  isRegenerating: boolean;
  /** Starts a rewrite with the chosen template. */
  onApplyTemplate: (templateId: string) => void;
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
  onApplyTemplate,
  isActive,
  onSelect,
  className,
}: CallSummaryTemplatePickerProps): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [templatesModalMode, setTemplatesModalMode] = useState<'browse' | 'new' | null>(null);
  const [shouldLoadTemplates, setShouldLoadTemplates] = useState(false);
  const currentUser = useSelf();

  const { templates, isLoading: templatesLoading } = useSummaryTemplates(
    shouldLoadTemplates || templatesModalMode !== null,
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

  // The list is only fetched once the menu opens, so on a fresh visit look up the
  // applied template directly — otherwise the pill reads "Default summary".
  const storedTemplateId = selectedTemplateId ?? '';
  const [storedTemplate] = useCachedQuery(
    queries.summaryTemplateById({ templateId: storedTemplateId }),
    { enabled: storedTemplateId.length > 0 && storedTemplateId !== DEFAULT_TEMPLATE_OPTION.id },
  );

  const selectedTemplate =
    templateOptions.find(template => template.id === selectedTemplateId) ??
    (storedTemplate && storedTemplate.id === storedTemplateId
      ? {
          id: storedTemplate.id,
          name: storedTemplate.name,
          icon: getTemplateIcon(storedTemplate.name),
        }
      : DEFAULT_TEMPLATE_OPTION);

  const fullLabel = getSummaryTemplateLabel(selectedTemplate);
  const label = truncateTemplateName(fullLabel);

  const trigger = (
    <button
      type='button'
      role='tab'
      aria-selected={isActive}
      onClick={() => {
        if (!isActive) onSelect();
      }}
      title={fullLabel}
      aria-busy={isRegenerating}
      data-track-category='CallDetail'
      data-track-name='open_summary_templates'
      className={cn('max-w-[200px]', isRegenerating && 'cursor-wait', className)}
    >
      <SummaryTemplateGlyph template={selectedTemplate} size='trigger' className='shrink-0' />
      <span className='truncate'>{label}</span>
      {isActive && (
        <ChevronBigDown strokeWidth={2} className='size-3.5 shrink-0' aria-hidden='true' />
      )}
    </button>
  );

  return (
    <>
      <Popover
        trigger={trigger}
        open={isActive && isMenuOpen}
        onOpenChange={open => {
          if (!isActive || isRegenerating) return;
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
          onSelectTemplate={onApplyTemplate}
          onRegenerate={() => onApplyTemplate(selectedTemplate.id)}
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
              onApplyTemplate(template.id);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
