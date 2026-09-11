/**
 * Body of the summary-template picker popover: the selected template, a refresh
 * action, the other templates, and the two escape hatches into the templates modal.
 *
 * Shared by the recording detail screen and the call detail screen. Only the menu
 * is shared — each host owns its own trigger and popover, because one is an
 * animated segmented control and the other a plain tab pill.
 */

import type { ReactElement } from 'react';
import {
  Refresh,
  CheckTickSingle,
  GridDashboardBento,
  Hashtag,
  PlusDefault,
  Spinner,
} from '@xyne/icons';
import { XyneAIStar } from '@/components/icons/xyne-ai';
import { cn } from '../../utils/classNames';
import { Tooltip } from '../ui/Tooltip';

import type { SummaryTemplateMenuProps, SummaryTemplateOption } from './SummaryTemplateMenu.types';
import {
  getSummaryTemplateLabel,
  isDefaultSummaryTemplate,
  truncateTemplateName,
} from './SummaryTemplateMenu.utils';

/**
 * Icon standing in for a template: its own emoji when custom, the AI star for the
 * default. `size` differs between the tab trigger and the menu's own rows.
 */
export function SummaryTemplateGlyph({
  template,
  size,
  className,
}: {
  template: SummaryTemplateOption | undefined;
  size: 'trigger' | 'menu';
  className?: string;
}): ReactElement {
  if (isDefaultSummaryTemplate(template)) {
    return <XyneAIStar size={size === 'trigger' ? 12 : 14} />;
  }
  if (size === 'trigger') {
    return <Hashtag className={cn('size-3.5', className)} aria-hidden='true' />;
  }
  return (
    <span aria-hidden='true' className='leading-none'>
      {template?.icon}
    </span>
  );
}

export function SummaryTemplateMenu({
  selectedTemplate,
  templates,
  isLoading = false,
  isRegenerating = false,
  regeneratingTemplateId,
  canRegenerate = true,
  onSelectTemplate,
  onRegenerate,
  onOpenTemplates,
  onNewTemplate,
  onRequestClose,
  trackCategory,
}: SummaryTemplateMenuProps): ReactElement {
  const fullLabel = getSummaryTemplateLabel(selectedTemplate);
  const label = truncateTemplateName(fullLabel);
  const selectedTemplateId = selectedTemplate?.id ?? 'default';
  const activeRegeneratingTemplateId = isRegenerating
    ? (regeneratingTemplateId ?? selectedTemplateId)
    : null;
  const regeneratingTemplate =
    templates.find(template => template.id === activeRegeneratingTemplateId) ??
    (selectedTemplateId === activeRegeneratingTemplateId ? selectedTemplate : undefined);
  const regeneratingTemplateLabel = regeneratingTemplate
    ? getSummaryTemplateLabel(regeneratingTemplate)
    : activeRegeneratingTemplateId === 'default' || !activeRegeneratingTemplateId
      ? getSummaryTemplateLabel(undefined)
      : 'selected template';
  const regeneratingTooltipContent = `Generating ${regeneratingTemplateLabel} summary`;
  const isSelectedTemplateRegenerating = activeRegeneratingTemplateId === selectedTemplateId;
  const isDisabledDuringRegeneration = isRegenerating;
  const renderRegeneratingSpinner = (): ReactElement => (
    <Tooltip content={regeneratingTooltipContent} side='right'>
      <span
        className='flex size-full items-center justify-center'
        aria-label={regeneratingTooltipContent}
      >
        <Spinner size={14} className='animate-spin text-muted-foreground' />
      </span>
    </Tooltip>
  );

  return (
    <>
      <div className='flex items-center gap-0.5 rounded-lg p-0.5'>
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-semibold',
            isDisabledDuringRegeneration && !isSelectedTemplateRegenerating
              ? 'text-muted-foreground'
              : 'text-foreground',
          )}
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold shadow-sm',
              isDisabledDuringRegeneration && !isSelectedTemplateRegenerating && 'opacity-50',
            )}
          >
            {isSelectedTemplateRegenerating ? (
              renderRegeneratingSpinner()
            ) : (
              <SummaryTemplateGlyph template={selectedTemplate} size='menu' />
            )}
          </span>
          <span
            className='min-w-0 flex-1 truncate'
            title={isSelectedTemplateRegenerating ? regeneratingTooltipContent : fullLabel}
          >
            {label}
          </span>
        </span>
        <button
          type='button'
          disabled={isRegenerating || !canRegenerate}
          onClick={() => {
            onRequestClose();
            onRegenerate();
          }}
          data-ph-capture-attribute-track-id='regenerate_selected_summary_template'
          data-ph-capture-attribute-track-category={trackCategory}
          aria-label={`Regenerate with ${fullLabel}`}
          className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category={trackCategory}
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
        {isLoading ? (
          <p className='px-2.5 py-1.5 text-sm text-muted-foreground'>Loading templates…</p>
        ) : (
          templates
            .filter(template => template.id !== selectedTemplate?.id)
            .map(template => {
              const isTemplateRegenerating = activeRegeneratingTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  type='button'
                  aria-disabled={isDisabledDuringRegeneration}
                  tabIndex={isDisabledDuringRegeneration ? -1 : undefined}
                  onClick={() => {
                    if (isDisabledDuringRegeneration) return;
                    onRequestClose();
                    onSelectTemplate(template.id);
                  }}
                  data-ph-capture-attribute-track-id='select_summary_template'
                  data-ph-capture-attribute-trackCategory={trackCategory}
                  title={isTemplateRegenerating ? regeneratingTooltipContent : template.name}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                    isTemplateRegenerating
                      ? 'text-foreground'
                      : isDisabledDuringRegeneration
                        ? 'cursor-not-allowed text-muted-foreground/55'
                        : 'text-foreground hover:bg-muted',
                  )}
                  data-track-category={trackCategory}
                  data-track-name='select_summary_template'
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold shadow-sm',
                      isDisabledDuringRegeneration && !isTemplateRegenerating && 'opacity-45',
                    )}
                  >
                    {isTemplateRegenerating ? renderRegeneratingSpinner() : template.icon}
                  </span>
                  <span className='min-w-0 flex-1 truncate'>
                    {truncateTemplateName(template.name)}
                  </span>
                </button>
              );
            })
        )}
      </div>

      <div className='mx-1.5 my-1.5 h-px bg-border' />
      <button
        type='button'
        disabled={isDisabledDuringRegeneration}
        onClick={() => {
          onRequestClose();
          onOpenTemplates();
        }}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors',
          isDisabledDuringRegeneration
            ? 'cursor-not-allowed text-muted-foreground/55'
            : 'text-foreground hover:bg-muted',
        )}
        data-track-category={trackCategory}
        data-track-name='open_all_summary_templates'
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground',
            isDisabledDuringRegeneration && 'opacity-45',
          )}
        >
          <GridDashboardBento strokeWidth={2} className='size-4' />
        </span>
        All templates…
      </button>
      <button
        type='button'
        disabled={isDisabledDuringRegeneration}
        onClick={() => {
          onRequestClose();
          onNewTemplate();
        }}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors',
          isDisabledDuringRegeneration
            ? 'cursor-not-allowed text-muted-foreground/55'
            : 'text-foreground hover:bg-muted',
        )}
        data-track-category={trackCategory}
        data-track-name='new_summary_template'
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground',
            isDisabledDuringRegeneration && 'opacity-45',
          )}
        >
          <PlusDefault className='size-4' />
        </span>
        New template
      </button>
    </>
  );
}
