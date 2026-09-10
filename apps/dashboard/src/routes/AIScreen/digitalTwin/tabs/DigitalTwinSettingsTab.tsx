import { ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PencilEdit, ShieldCheck } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { DetailCard } from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { SettingCardHeader } from '../components/SettingCardHeader';
import { useClawDigitalTwinStatus, useUpdateDigitalTwinSettings } from '@/hooks/useClawDigitalTwin';

const MAX_SUFFIX_LEN = 500;
const MIN_SCORE = 0.7;
const MAX_SCORE = 1;
const SCORE_STEP = 0.05;

const DigitalTwinSettingsTab = (): ReactElement => {
  const { data: status, isLoading } = useClawDigitalTwinStatus();
  const updateMutation = useUpdateDigitalTwinSettings();

  const initialSuffix = status?.responseSuffix ?? '';
  const initialAuto = status?.memoryApprovalMode === 'auto';
  const initialScore = status?.memoryAutoApproveMinScore ?? 0.9;

  const [suffix, setSuffix] = useState(initialSuffix);
  const [auto, setAuto] = useState(initialAuto);
  const [score, setScore] = useState(initialScore);

  useEffect(() => {
    setSuffix(status?.responseSuffix ?? '');
    setAuto(status?.memoryApprovalMode === 'auto');
    setScore(status?.memoryAutoApproveMinScore ?? 0.9);
  }, [status?.responseSuffix, status?.memoryApprovalMode, status?.memoryAutoApproveMinScore]);

  const charCount = suffix.length;
  const dirty =
    suffix.trim() !== initialSuffix.trim() ||
    auto !== initialAuto ||
    (auto && score !== initialScore);

  const save = (): void => {
    updateMutation.mutate(
      {
        responseSuffix: suffix || null,
        memoryApprovalMode: auto ? 'auto' : 'manual',
        ...(auto ? { memoryAutoApproveMinScore: score } : {}),
      },
      { onSuccess: () => toast.success('Settings saved') },
    );
  };

  if (isLoading && !status) {
    return (
      <div className='flex w-full flex-col gap-3'>
        <Skeleton className='h-56 w-full rounded-2xl' />
        <Skeleton className='h-28 w-full rounded-2xl' />
      </div>
    );
  }

  const fillPct = ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;

  return (
    <div className='flex w-full flex-col gap-3'>
      <DetailCard>
        <SettingCardHeader
          icon={PencilEdit}
          title='Response suffix'
          description='Appended to every reply your Twin sends on your behalf. Leave blank to post replies as-is.'
          trailing={
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                charCount >= MAX_SUFFIX_LEN ? 'text-status-pending' : 'text-muted-foreground',
              )}
            >
              {charCount} / {MAX_SUFFIX_LEN}
            </span>
          }
        />
        <div className='flex flex-col gap-4 p-4'>
          <textarea
            value={suffix}
            onChange={e => setSuffix(e.target.value.slice(0, MAX_SUFFIX_LEN))}
            placeholder='Sent by my Digital Twin · may contain mistakes'
            rows={3}
            maxLength={MAX_SUFFIX_LEN}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin response suffix'
            className='w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none'
          />
          {suffix.trim().length > 0 && (
            <div className='rounded-lg border border-border bg-muted/40 p-3'>
              <p className='mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Preview
              </p>
              <p className='whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground'>
                <span>[your Twin&apos;s reply]</span>
                {'\n\n'}
                <span className='text-primary'>{suffix.trim()}</span>
              </p>
            </div>
          )}
        </div>
      </DetailCard>

      <DetailCard>
        <SettingCardHeader
          icon={ShieldCheck}
          title='Memory approval'
          description={
            auto
              ? 'High-confidence memories are saved automatically. Lower-confidence ones still wait for your review.'
              : 'Every memory waits in your review queue until you approve it.'
          }
          divided={auto}
          trailing={
            <Switch
              checked={auto}
              onCheckedChange={setAuto}
              aria-label='Auto-approve high-confidence memories'
            />
          }
        />
        <div className='flex flex-col gap-4 p-4 empty:hidden'>
          {auto && (
            <div className='rounded-lg border border-border bg-muted/40 p-4'>
              <div className='mb-3 flex items-center justify-between gap-3 text-xs'>
                <span className='text-muted-foreground'>Auto-approve at or above</span>
                <span className='tabular-nums text-foreground'>{score.toFixed(2)}</span>
              </div>
              <input
                type='range'
                min={MIN_SCORE}
                max={MAX_SCORE}
                step={SCORE_STEP}
                value={score}
                onChange={e => setScore(Number(e.target.value))}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin auto-approve threshold'
                style={{
                  background: `linear-gradient(to right, hsl(var(--primary)) ${fillPct}%, hsl(var(--border)) ${fillPct}%)`,
                }}
                className='h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
              />
              <div className='mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
                <span>{MIN_SCORE.toFixed(2)} · more memories</span>
                <span>{MAX_SCORE.toFixed(2)} · only the surest</span>
              </div>
            </div>
          )}
        </div>
      </DetailCard>

      <div className='flex items-center justify-end gap-3 pt-1'>
        {!dirty && <span className='text-xs text-muted-foreground'>No unsaved changes</span>}
        <Button onClick={save} loading={updateMutation.isPending} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </div>
  );
};

export default DigitalTwinSettingsTab;
