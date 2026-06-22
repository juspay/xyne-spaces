import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Tooltip from '../../../ui/Tooltip';
import { Switch } from '../../../ui/Switch';
import { apiInstance } from '../../../../services/clients/apiClient';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AiSyncTabProps {
  channelId: string;
  form: DeskSettingsForm;
}

export const AiSyncTab: React.FC<AiSyncTabProps> = ({ channelId, form }) => {
  const { canManage, classificationEnabledSaved, priorityEnabledSaved, autoAIDraftSaved } = form;

  const [syncClassification, setSyncClassification] = useState(false);
  const [syncPriority, setSyncPriority] = useState(false);
  const [syncAutoDraft, setSyncAutoDraft] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncCooldownUntil, setSyncCooldownUntil] = useState<number | null>(null);

  useEffect(() => {
    apiInstance
      .get<{ cooldownActive: boolean }>(`/channels/${channelId}/ai-retrigger/status`)
      .then(res => {
        if (res.data.cooldownActive) {
          setSyncCooldownUntil(Date.now() + 10 * 60 * 1000);
        }
      })
      .catch(() => undefined);
  }, [channelId]);

  // Auto-clear the cooldown when it expires
  useEffect(() => {
    if (syncCooldownUntil === null) return;
    const remaining = syncCooldownUntil - Date.now();
    if (remaining <= 0) {
      setSyncCooldownUntil(null);
      return;
    }
    const timer = setTimeout(() => setSyncCooldownUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [syncCooldownUntil]);

  const inCooldown = syncCooldownUntil !== null && Date.now() < syncCooldownUntil;
  const anySelected = syncClassification || syncPriority || syncAutoDraft;

  const handleSyncToggle = useCallback(
    (
      featureEnabled: boolean,
      featureLabel: string,
      setter: (v: boolean) => void,
      value: boolean,
    ) => {
      if (!value) {
        setter(false);
        return;
      }
      if (!featureEnabled) {
        toast.warning(
          `Enable "${featureLabel}" in AI Features first before including it in AI Sync.`,
        );
        return;
      }
      setter(true);
    },
    [],
  );

  const handleRunSync = useCallback(async (): Promise<void> => {
    if (syncLoading || inCooldown || !anySelected) return;
    setSyncLoading(true);
    const toastId = toast.loading('Running AI Sync…');
    try {
      const res = await apiInstance.post<{
        enqueued: { classify: number; priority: number; draft: number };
        ticketsScanned: number;
        estimatedMinutes: number;
        cooldownSeconds: number;
      }>(`/channels/${channelId}/ai-retrigger`, {
        features: {
          classification: syncClassification,
          priority: syncPriority,
          autoDraft: syncAutoDraft,
        },
      });
      const { enqueued, ticketsScanned, estimatedMinutes, cooldownSeconds } = res.data;
      const total = enqueued.classify + enqueued.priority + enqueued.draft;
      if (cooldownSeconds > 0) setSyncCooldownUntil(Date.now() + cooldownSeconds * 1000);

      if (total === 0) {
        toast.success(`Scanned ${ticketsScanned} tickets — all up to date, nothing to sync.`, {
          id: toastId,
        });
      } else {
        const parts: string[] = [];
        if (enqueued.classify) parts.push(`${enqueued.classify} classification`);
        if (enqueued.priority) parts.push(`${enqueued.priority} priority`);
        if (enqueued.draft) parts.push(`${enqueued.draft} draft`);
        toast.success(
          `AI Sync queued ${parts.join(', ')} across ${ticketsScanned} tickets. ETA ~${estimatedMinutes} min.`,
          { id: toastId },
        );
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
      if (axiosErr?.response?.status === 429) setSyncCooldownUntil(Date.now() + 10 * 60 * 1000);
      toast.error(axiosErr?.response?.data?.error ?? 'AI Sync failed', { id: toastId });
    } finally {
      setSyncLoading(false);
    }
  }, [
    channelId,
    syncLoading,
    inCooldown,
    anySelected,
    syncClassification,
    syncPriority,
    syncAutoDraft,
  ]);

  const NON_OWNER_MSG = 'Only the desk owner or admin can manage AI Sync';

  const MaybeTooltip = ({
    children,
    side,
  }: {
    children: React.ReactElement;
    side: 'left' | 'bottom';
  }): React.ReactElement =>
    canManage ? (
      children
    ) : (
      <Tooltip content={NON_OWNER_MSG} side={side}>
        {children}
      </Tooltip>
    );

  return (
    <div className='flex flex-col gap-[32px]'>
      <div className='flex flex-col gap-[4px]'>
        <div className='text-desk-label'>AI Sync</div>
        <div className='text-desk-helper'>
          Re-run AI features on tickets from the last 3 days where they haven&apos;t run yet. Enable
          the toggles for the features you want to include, then click Run AI Sync.
        </div>
      </div>

      <div className='flex flex-col gap-[16px]'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>Auto-Classification</div>
            <div className='text-desk-helper'>
              Re-run classification on tickets where aiCategory is missing.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncClassification}
                onCheckedChange={v =>
                  handleSyncToggle(
                    classificationEnabledSaved,
                    'Auto-Classification',
                    setSyncClassification,
                    v,
                  )
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncToggleClassification'
              />
            </span>
          </MaybeTooltip>
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>AI Priority Detection</div>
            <div className='text-desk-helper'>
              Re-run priority detection on tickets where aiPriority is missing.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncPriority}
                onCheckedChange={v =>
                  handleSyncToggle(
                    priorityEnabledSaved,
                    'AI Priority Detection',
                    setSyncPriority,
                    v,
                  )
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncTogglePriority'
              />
            </span>
          </MaybeTooltip>
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>Auto AI Draft</div>
            <div className='text-desk-helper'>
              Generate drafts for tickets that don&apos;t have one yet.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncAutoDraft}
                onCheckedChange={v =>
                  handleSyncToggle(autoAIDraftSaved, 'Auto AI Draft', setSyncAutoDraft, v)
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncToggleAutoDraft'
              />
            </span>
          </MaybeTooltip>
        </div>
      </div>

      <MaybeTooltip side='bottom'>
        <span className='inline-flex self-start'>
          <button
            type='button'
            className='inline-flex items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => {
              void handleRunSync();
            }}
            disabled={!canManage || syncLoading || inCooldown || !anySelected}
            data-track-category='DeskSettings'
            data-track-name='RunAiSync'
          >
            {syncLoading ? <Loader2 size={14} className='animate-spin' /> : <Sparkles size={14} />}
            {inCooldown ? 'AI Sync ran recently — wait a few minutes' : 'Run AI Sync'}
          </button>
        </span>
      </MaybeTooltip>
    </div>
  );
};
