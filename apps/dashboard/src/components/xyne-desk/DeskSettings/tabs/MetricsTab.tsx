import React, { useEffect, useMemo, useState } from 'react';
import { FormFieldType, type FormFields } from '@xyne/shared';
import { Switch } from '../../../ui/Switch';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { CHART_VIEW_LABELS } from '../../../../hooks/usePersistedDeskMetricsFilters';
import { useZero } from '../../../../hooks/useZero';
import { queries } from '../../../../zero/queries';
import { resolveDisplayFormFields } from '../../../../utils/board/resolveDisplayFormFields';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface MetricsTabProps {
  form: DeskSettingsForm;
}

export const MetricsTab: React.FC<MetricsTabProps> = ({ form }) => {
  const zero = useZero();
  const {
    metricsEnabled,
    setMetricsEnabled,
    frtStageNames,
    setFrtStageNames,
    boardId,
    canManage,
    channelId,
    guestVisibility,
    toggleGuestVisibility,
  } = form;

  const [fallbackBoardId, setFallbackBoardId] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId || boardId) return;

    let cancelled = false;
    void zero
      .run(
        queries.supportTicketsPageV4({
          channelId,
          isMember: true,
          limit: 1,
          start: null,
          dir: 'forward',
        }),
        { type: 'complete' },
      )
      .then(rows => {
        if (!cancelled) setFallbackBoardId(rows[0]?.boardId ?? null);
      });

    return (): void => {
      cancelled = true;
    };
  }, [boardId, channelId, zero]);

  const effectiveBoardId = boardId ?? fallbackBoardId;

  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: effectiveBoardId ?? '' }), {
    enabled: !!effectiveBoardId,
  });
  const [boardDetail] = useCachedQuery(
    queries.boardDetailById({ boardId: effectiveBoardId ?? '' }),
    { enabled: !!effectiveBoardId },
  );

  // Every board custom field is a table column; DATE and DOC fields can't be charted.
  const [columnFieldNames, chartFieldNames] = useMemo(() => {
    const fieldTypes = new Map<string, string>();
    for (const mapping of boardDetail?.formContextMappings ?? []) {
      const { formId, formFields } = mapping as unknown as {
        formId?: string;
        formFields?: FormFields[];
      };
      for (const field of formId ? resolveDisplayFormFields(formId, formFields ?? []) : []) {
        fieldTypes.set(field.fieldName, field.fieldType);
      }
    }
    const names = [...fieldTypes.keys()].sort();
    const chartable = (name: string): boolean =>
      fieldTypes.get(name) !== FormFieldType.DATE && fieldTypes.get(name) !== FormFieldType.DOC;
    return [names, names.filter(chartable)] as const;
  }, [boardDetail]);

  const guestOptionGroups: Record<string, Record<string, string>> = {
    'Summary cards': {
      'kpi:ticketsCreated': 'Tickets created',
      'kpi:avgFirstResponse': 'Avg first response',
      'kpi:avgResolution': 'Avg resolution',
      'kpi:csat': 'CSAT',
      'kpi:emailReplies': 'Email replies',
    },
    Sections: {
      stageCounts: 'Tickets by stage',
      ticketTable: 'Ticket table',
      csvDownload: 'CSV download',
      moreFilters: 'More filters',
      agentsTab: 'Agents tab',
    },
    'Chart breakdowns': Object.fromEntries([
      // Guests only ever see one desk, so there is no desk breakdown to offer.
      ...Object.entries(CHART_VIEW_LABELS)
        .filter(([view]) => view !== 'desk')
        .map(([view, label]) => [`chart:${view}`, label] as const),
      ...chartFieldNames.map(name => [`chart:field:${name}`, name] as const),
    ]),
    'Table columns': {
      'column:id': 'ID',
      'column:title': 'Title',
      'column:assignee': 'Assignee',
      'column:priority': 'Priority',
      'column:stage': 'Stage',
      'column:frt': 'FRT',
      'column:rt': 'RT',
      'column:csat': 'CSAT',
      'column:tags': 'Tags',
      ...Object.fromEntries(columnFieldNames.map(name => [`column:field:${name}`, name] as const)),
      'column:createdAt': 'Created at',
      'column:age': 'Age',
    },
  };

  // "__emailReply" sentinel in frtStageNames means email-reply arm is active.
  // Empty array (legacy) → also treated as email-reply active for backward compat.
  const emailReplyChecked = frtStageNames.length === 0 || frtStageNames.includes('__emailReply');
  const selectedStages = useMemo(
    () => frtStageNames.filter(n => n !== '__emailReply'),
    [frtStageNames],
  );

  const toggleEmailReply = (): void => {
    const nowChecked = !emailReplyChecked;
    setFrtStageNames(nowChecked ? ['__emailReply', ...selectedStages] : selectedStages);
  };

  const toggleStage = (stageName: string): void => {
    const isSelected = selectedStages.includes(stageName);
    const nextStages = isSelected
      ? selectedStages.filter(s => s !== stageName)
      : [...selectedStages, stageName];
    setFrtStageNames(emailReplyChecked ? ['__emailReply', ...nextStages] : nextStages);
  };

  return (
    <>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex flex-col gap-[4px]'>
          <div className='text-desk-label'>Desk metrics</div>
          <div className='text-desk-helper w-full max-w-[500px]'>
            Show a metrics dashboard for this desk (first response time, resolution time, CSAT,
            ticket counts and activity). Metrics are collected from the time this is enabled.
          </div>
        </div>
        <Switch
          variant='desk'
          checked={metricsEnabled}
          onCheckedChange={setMetricsEnabled}
          disabled={!canManage}
          aria-label='Toggle desk metrics'
        />
      </div>

      {metricsEnabled && (
        <div className='flex flex-col gap-[12px]'>
          <div>
            <div className='text-sm font-medium text-foreground'>
              What stops the first-response clock?
            </div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              FRT stops on the first qualifying event. Select any combination — whichever happens
              first wins. If nothing is selected, FRT will not be tracked.
            </div>
          </div>

          {/* Email reply option — always shown, default checked */}
          <div className='flex items-center gap-2'>
            <Checkbox
              checked={emailReplyChecked}
              onChange={toggleEmailReply}
              disabled={!canManage}
              size='sm'
              label='Agent sends an email reply'
              labelClassName='text-sm text-foreground'
            />
            <span className='text-xs text-muted-foreground'>(default)</span>
          </div>

          {/* Stage options */}
          {!effectiveBoardId ? (
            <p className='text-desk-helper'>
              No board is linked to this desk yet. Link a board to pick stages.
            </p>
          ) : (stages ?? []).length === 0 ? (
            <p className='text-desk-helper'>No stages found on this desk&rsquo;s board.</p>
          ) : (
            <div className='flex flex-col gap-1.5'>
              <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                Or when ticket enters stage
              </div>
              {(stages ?? []).map(stage => (
                <div key={stage.id} className='flex items-center gap-2'>
                  <Checkbox
                    checked={selectedStages.includes(stage.name)}
                    onChange={() => toggleStage(stage.name)}
                    disabled={!canManage}
                    size='sm'
                    label={stage.name}
                    labelClassName='text-sm text-foreground'
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {metricsEnabled && canManage && (
        <div className='flex flex-col gap-[12px]'>
          <div>
            <div className='text-sm font-medium text-foreground'>What can guests see?</div>
            <div className='text-desk-helper w-full max-w-[500px]'>
              Guests see these parts of the metrics dashboard unless you turn them off.
            </div>
          </div>
          {Object.entries(guestOptionGroups).map(([title, options]) => (
            <div key={title} className='flex flex-col gap-1.5'>
              <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                {title}
              </div>
              {Object.entries(options).map(([key, label]) => (
                <Checkbox
                  key={key}
                  checked={guestVisibility[key] !== false}
                  onChange={() => toggleGuestVisibility(key)}
                  size='sm'
                  label={label}
                  labelClassName='text-sm text-foreground'
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
};
