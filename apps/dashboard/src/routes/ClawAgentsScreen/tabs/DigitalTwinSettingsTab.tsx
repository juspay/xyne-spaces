import { ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { useClawDigitalTwinStatus, useUpdateDigitalTwinSettings } from '@/hooks/useClawDigitalTwin';

const MAX_SUFFIX_LEN = 500;
// Mirrors MIN/MAX_AUTO_APPROVE_SCORE in the backend (re-validated server-side).
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

  // Re-seed when the status first loads or changes underneath us.
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
      <div className='flex max-w-2xl flex-col gap-8'>
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-28 w-full rounded-xl' />
      </div>
    );
  }

  return (
    <div className='flex max-w-2xl flex-col'>
      {/* Response suffix */}
      <section className='flex flex-col gap-3'>
        <div>
          <h2 className='text-sm font-semibold text-foreground'>Response suffix</h2>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
            Appended to every reply your Twin sends on your behalf. Leave blank to post replies
            as-is.
          </p>
        </div>
        <textarea
          value={suffix}
          onChange={e => setSuffix(e.target.value.slice(0, MAX_SUFFIX_LEN))}
          placeholder='— Sent by my Digital Twin · may contain mistakes'
          rows={3}
          maxLength={MAX_SUFFIX_LEN}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin response suffix'
          className='w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none'
        />
        <div className='flex justify-end text-[11px]'>
          <span
            className={cn(
              'tabular-nums',
              charCount >= MAX_SUFFIX_LEN
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
          >
            {charCount} / {MAX_SUFFIX_LEN}
          </span>
        </div>
        {suffix.trim().length > 0 && (
          <div className='rounded-lg border border-border bg-muted/40 p-3'>
            <p className='mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Preview
            </p>
            <p className='whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground'>
              <span>[your Twin&apos;s reply]</span>
              {'\n\n'}
              <span className='text-primary'>{suffix.trim()}</span>
            </p>
          </div>
        )}
      </section>

      <div className='my-8 border-t border-border' />

      {/* Memory approval */}
      <section className='flex flex-col gap-4'>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0'>
            <h2 className='text-sm font-semibold text-foreground'>Memory approval</h2>
            <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
              {auto
                ? 'High-confidence memories are saved automatically. Lower-confidence ones still wait for your review.'
                : 'Every memory waits in your review queue until you approve it.'}
            </p>
          </div>
          <Switch
            checked={auto}
            onCheckedChange={setAuto}
            aria-label='Auto-approve high-confidence memories'
          />
        </div>

        {auto && (
          <div className='rounded-lg border border-border bg-muted/40 p-4'>
            <div className='mb-1.5 flex items-center justify-between text-xs'>
              <span className='text-muted-foreground'>Auto-approve at or above</span>
              <span className='font-mono text-foreground'>{score.toFixed(2)}</span>
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
              className='w-full accent-primary'
            />
            <div className='mt-1 flex justify-between text-[10px] text-muted-foreground'>
              <span>{MIN_SCORE.toFixed(2)} · more memories</span>
              <span>{MAX_SCORE.toFixed(2)} · only the surest</span>
            </div>
          </div>
        )}
      </section>

      <div className='mt-8 flex items-center gap-3 border-t border-border pt-6'>
        <Button
          onClick={save}
          data-track-category='Claw Agents'
          data-track-name='SAVE_DIGITAL_TWIN_SETTINGS'
          loading={updateMutation.isPending}
          disabled={!dirty}
        >
          Save changes
        </Button>
        {!dirty && <span className='text-xs text-muted-foreground'>No unsaved changes</span>}
      </div>
    </div>
  );
};

export default DigitalTwinSettingsTab;
