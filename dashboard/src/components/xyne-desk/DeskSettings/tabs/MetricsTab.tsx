import React, { useMemo } from 'react';
import { Switch } from '../../../ui/Switch';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface MetricsTabProps {
  form: DeskSettingsForm;
}

export const MetricsTab: React.FC<MetricsTabProps> = ({ form }) => {
  const {
    metricsEnabled,
    setMetricsEnabled,
    frtStageNames,
    setFrtStageNames,
    boardId,
    canManage,
    channelId,
  } = form;

  const [channelTickets] = useCachedQuery(
    queries.supportTicketsFilteredV3({ channelId: channelId ?? '', isMember: true }),
    { enabled: !!channelId && !boardId },
  );
  const effectiveBoardId = boardId ?? channelTickets?.[0]?.boardId ?? null;

  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: effectiveBoardId ?? '' }), {
    enabled: !!effectiveBoardId,
  });

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
            />
            <span className='text-sm text-foreground'>Agent sends an email reply</span>
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
                  />
                  <span className='text-sm text-foreground'>{stage.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};
