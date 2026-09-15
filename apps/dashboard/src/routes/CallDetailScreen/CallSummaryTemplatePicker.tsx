/**
 * Summary-template picker for the call detail view. The tab pill itself is the
 * trigger; the menu inside is the shared `SummaryTemplateMenu`, the same one the
 * recording detail screen hangs off its summary tab.
 *
 * Picking a template rewrites the call's detailed summary through
 * `POST /calls/:callId/generate-summary` — the same handler the recordings
 * screen reaches under `/recordings/:callId`, mounted a second time for calls
 * (see calls.ts, which does exactly this for `/sharing` too). Generation is
 * owned by the parent screen, which watches the call's live row for the
 * resulting status; this component only renders the menu and reports the pick.
 */

import { useState, type ReactElement } from 'react';
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
  /** Template the call's existing summary was written with, when one is recorded. */
  selectedTemplateId?: string | null;
  /** True while the detailed summary is the visible pane. */
  isActive: boolean;
  /** Called when an inactive pill is clicked, to switch to the summary pane. */
  onSelect: () => void;
  onRegenerate?: ((templateId: string, templateName: string) => void) | undefined;
  isRegenerating?: boolean;
  regeneratingTemplateId?: string | undefined;
  regeneratingTemplateName?: string | undefined;
  /** Pill classes from the parent, so this matches the other tabs exactly. */
  className?: string;
}

export function CallSummaryTemplatePicker({
  selectedTemplateId,
  isActive,
  onSelect,
  onRegenerate,
  isRegenerating = false,
  regeneratingTemplateId,
  regeneratingTemplateName,
  className,
}: CallSummaryTemplatePickerProps): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [templatesModalMode, setTemplatesModalMode] = useState<'browse' | 'new' | null>(null);
  const [shouldLoadTemplates, setShouldLoadTemplates] = useState(false);
  const currentUser = useSelf();

  const { templates, isLoading: templatesLoading } = useSummaryTemplates(
    shouldLoadTemplates || templatesModalMode !== null,
  );
  const storedTemplateId = selectedTemplateId ?? '';
  const [storedTemplate] = useCachedQuery(
    queries.summaryTemplateById({ templateId: storedTemplateId }),
    {
      enabled: storedTemplateId.length > 0 && storedTemplateId !== DEFAULT_TEMPLATE_OPTION.id,
    },
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

  const storedTemplateOption: SummaryTemplateOption | undefined =
    storedTemplate && storedTemplate.id === selectedTemplateId
      ? {
          id: storedTemplate.id,
          name: storedTemplate.name,
          icon: getTemplateIcon(storedTemplate.name),
        }
      : undefined;

  const selectedTemplate: SummaryTemplateOption =
    templateOptions.find(template => template.id === selectedTemplateId) ??
    storedTemplateOption ??
    DEFAULT_TEMPLATE_OPTION;

  const fullLabel = getSummaryTemplateLabel(selectedTemplate);
  const label = truncateTemplateName(fullLabel);
  const regeneratingTooltip = regeneratingTemplateName
    ? `Generating ${regeneratingTemplateName} summary`
    : 'Generating summary';

  const regenerate = (templateId: string): void => {
    const name =
      templates.find(template => template.id === templateId)?.name ??
      (templateId === DEFAULT_TEMPLATE_OPTION.id ? 'Default' : 'Call');
    onRegenerate?.(templateId, name);
  };

  const trigger = (
    <button
      type='button'
      role='tab'
      aria-selected={isActive}
      aria-busy={isRegenerating}
      onClick={() => {
        if (!isActive) onSelect();
      }}
      title={isRegenerating ? regeneratingTooltip : fullLabel}
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
      {isRegenerating && (
        <Tooltip content={regeneratingTooltip} side='top'>
          <span
            className='flex size-3 shrink-0 items-center justify-center'
            aria-label={regeneratingTooltip}
          >
            <Spinner size={12} className='animate-spin text-muted-foreground' />
          </span>
        </Tooltip>
      )}
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
          regeneratingTemplateId={regeneratingTemplateId}
          canRegenerate={Boolean(onRegenerate)}
          onSelectTemplate={regenerate}
          onRegenerate={() => regenerate(selectedTemplate.id)}
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
            {...(onRegenerate
              ? {
                  onApply: (template: { id: string }): void => {
                    setTemplatesModalMode(null);
                    regenerate(template.id);
                  },
                }
              : {})}
          />
        </Dialog>
      )}
    </>
  );
}
