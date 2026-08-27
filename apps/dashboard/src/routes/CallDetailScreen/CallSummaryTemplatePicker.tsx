/**
 * Summary-template picker for the call detail view. The tab pill itself is the
 * trigger; the menu inside is the shared `SummaryTemplateMenu`, the same one the
 * recording detail screen hangs off its summary tab.
 *
 * Browsing, creating and editing templates all work here; **applying** one does
 * not. Regeneration goes through `POST /calls/recordings/:callId/generate-summary`,
 * which rejects anything that isn't `CallType.HEADLESS`, and writes its canvas to
 * `call.metadata.detailedSummaryCanvasId` rather than the call message metadata
 * this screen reads. Until a call-side path exists, selecting a template says so
 * instead of firing a request that would 404.
 */

import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';
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
import { useSelf } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';

const DEFAULT_TEMPLATE_OPTION: SummaryTemplateOption = {
  id: 'default',
  name: DEFAULT_SUMMARY_TEMPLATE_NAME,
  icon: '✨',
};

const UNSUPPORTED_MESSAGE = "Summary templates aren't available for calls yet";

interface CallSummaryTemplatePickerProps {
  /** Template the call's existing summary was written with, when one is recorded. */
  selectedTemplateId?: string | null;
  /** True while the detailed summary is the visible pane. */
  isActive: boolean;
  /** Called when an inactive pill is clicked, to switch to the summary pane. */
  onSelect: () => void;
  /** Pill classes from the parent, so this matches the other tabs exactly. */
  className?: string;
}

export function CallSummaryTemplatePicker({
  selectedTemplateId,
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

  const selectedTemplate =
    templateOptions.find(template => template.id === selectedTemplateId) ?? DEFAULT_TEMPLATE_OPTION;

  const fullLabel = getSummaryTemplateLabel(selectedTemplate);
  const label = truncateTemplateName(fullLabel);

  const notifyUnsupported = (): void => {
    toast.info(UNSUPPORTED_MESSAGE);
  };

  const trigger = (
    <button
      type='button'
      role='tab'
      aria-selected={isActive}
      onClick={() => {
        if (!isActive) onSelect();
      }}
      title={fullLabel}
      data-track-category='CallDetail'
      data-track-name='open_summary_templates'
      className={cn('max-w-[200px]', className)}
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
          onSelectTemplate={notifyUnsupported}
          onRegenerate={notifyUnsupported}
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
            onApply={() => {
              setTemplatesModalMode(null);
              toast.info(UNSUPPORTED_MESSAGE);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
