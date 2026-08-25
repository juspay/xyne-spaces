/**
 * Summary-template picker for the call detail view — a port of the picker the
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
import {
  Refresh,
  CheckTickSingle,
  GridDashboardBento,
  Hashtag,
  PlusDefault,
  ChevronBigDown,
} from '@xyne/icons';
import { XyneAIStar } from '@/components/icons/xyne-ai';
import { Popover } from '../../components/ui/Popover';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  SummaryTemplatesModal,
  getTemplateIcon,
} from '../RecordingDetailV2Screen/components/SummaryTemplatesModal';
import { useSummaryTemplates } from '../../hooks/useSummaryTemplates';
import { useSelf } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';

interface SummaryTemplateOption {
  id: string;
  name: string;
  icon: string;
}

const DEFAULT_TEMPLATE_OPTION: SummaryTemplateOption = {
  id: 'default',
  name: 'Default summary',
  icon: '✨',
};

const TEMPLATE_NAME_MAX_LENGTH = 24;

const UNSUPPORTED_MESSAGE = "Summary templates aren't available for calls yet";

const truncateTemplateName = (name: string): string =>
  name.length > TEMPLATE_NAME_MAX_LENGTH
    ? `${name.slice(0, TEMPLATE_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;

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

  const fullLabel = selectedTemplate.name;
  const label = truncateTemplateName(fullLabel);
  const isCustomTemplate = selectedTemplate.id !== DEFAULT_TEMPLATE_OPTION.id;

  const notifyUnsupported = (): void => {
    setIsMenuOpen(false);
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
      {isCustomTemplate ? (
        <Hashtag className='size-3.5 shrink-0' aria-hidden='true' />
      ) : (
        <XyneAIStar size={12} />
      )}
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
        <div className='flex items-center gap-0.5 rounded-lg p-0.5'>
          <span className='flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-semibold text-foreground'>
            <span className='flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold shadow-sm'>
              {isCustomTemplate ? (
                <span aria-hidden='true' className='leading-none'>
                  {selectedTemplate.icon}
                </span>
              ) : (
                <XyneAIStar size={14} />
              )}
            </span>
            <span className='min-w-0 flex-1 truncate' title={fullLabel}>
              {label}
            </span>
          </span>
          <button
            type='button'
            onClick={notifyUnsupported}
            aria-label={`Regenerate with ${fullLabel}`}
            className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            data-track-category='CallDetail'
            data-track-name='regenerate_selected_summary_template'
          >
            <Refresh strokeWidth={2.5} className='size-4' />
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
            templateOptions
              .filter(template => template.id !== selectedTemplate.id)
              .map(template => (
                <button
                  key={template.id}
                  type='button'
                  onClick={notifyUnsupported}
                  title={template.name}
                  className='flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
                  data-track-category='CallDetail'
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
            setIsMenuOpen(false);
            setTemplatesModalMode('browse');
          }}
          className='flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
          data-track-category='CallDetail'
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
            setIsMenuOpen(false);
            setTemplatesModalMode('new');
          }}
          className='flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted'
          data-track-category='CallDetail'
          data-track-name='new_summary_template'
        >
          <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground'>
            <PlusDefault className='size-4' />
          </span>
          New template
        </button>
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
