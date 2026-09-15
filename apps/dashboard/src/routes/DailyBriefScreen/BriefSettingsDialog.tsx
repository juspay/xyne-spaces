import { ReactElement, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { cn } from '../../utils/classNames';
import { dailyBriefApi, DAILY_BRIEF_INSTRUCTIONS_LIMIT } from '../../api/dailyBriefApi';

const CAN_DO = [
  'Set the tone and length — terser, warmer, more analytical.',
  'Change what counts as important, e.g. “lead with anything touching payments”.',
  'Tell it what to ignore, e.g. “skip design tickets unless they block a release”.',
  'Shape a section, e.g. “name the blocker in every Waiting on others item”.',
];

interface BriefSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerate: () => void;
  /** A generation is already in flight — saving stays available, regenerating does not. */
  busy?: boolean;
}

export function BriefSettingsDialog({
  open,
  onOpenChange,
  onRegenerate,
  busy = false,
}: BriefSettingsDialogProps): ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void dailyBriefApi
      .getConfig()
      .then(config => {
        if (cancelled) return;
        setEnabled(config.instructionsEnabled);
        setInstructions(config.instructions);
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load your brief settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [open]);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      await dailyBriefApi.saveConfig({ instructionsEnabled: enabled, instructions });
      toast.success('Brief settings saved');
      return true;
    } catch {
      toast.error('Could not save your brief settings.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [enabled, instructions]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (await save()) onOpenChange(false);
  }, [save, onOpenChange]);

  const handleSaveAndRegenerate = useCallback(async (): Promise<void> => {
    if (busy) return;
    if (!(await save())) return;
    onOpenChange(false);
    onRegenerate();
  }, [busy, save, onOpenChange, onRegenerate]);

  const remaining = DAILY_BRIEF_INSTRUCTIONS_LIMIT - instructions.length;
  const overLimit = remaining < 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Brief settings'
      description='Customise how your daily brief is written'
      className='max-w-2xl'
    >
      <div className='p-6'>
        <div className='mb-6'>
          <h2 className='text-lg font-semibold text-foreground'>Brief settings</h2>
          <p className='mt-2 text-sm text-muted-foreground'>
            Add your own instructions to shape how the brief is written. The five sections — What
            needs you, Overdue, Waiting on others, Assigned to you and Today’s schedule — always
            stay the same.
          </p>
        </div>

        <div className='space-y-5'>
          <div className='flex items-start justify-between gap-4 rounded-lg border border-border p-4'>
            <div className='min-w-0'>
              <p className='text-sm font-medium text-foreground'>Use my instructions</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Turn off to keep your text but generate the default brief.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={loading || saving}
              aria-label='Use my instructions'
            />
          </div>

          <div>
            <label
              htmlFor='daily-brief-instructions'
              className='mb-2 block text-sm font-medium text-foreground'
            >
              Your instructions
            </label>
            <textarea
              id='daily-brief-instructions'
              value={instructions}
              onChange={event => setInstructions(event.target.value)}
              disabled={loading || saving}
              rows={7}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-settings-instructions'
              placeholder='e.g. Keep it under six lines. Lead with anything touching payments, and always name who I am waiting on.'
              className={cn(
                'w-full resize-none rounded-lg border bg-background px-3 py-2',
                'text-sm text-foreground placeholder:text-muted-foreground',
                'outline-none transition-colors focus:border-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
                overLimit ? 'border-destructive' : 'border-border',
              )}
            />
            <div className='mt-2 flex items-center justify-between gap-3'>
              <p className='text-xs text-muted-foreground'>
                Applies from the next brief you generate.
              </p>
              <p
                className={cn('text-xs', overLimit ? 'text-destructive' : 'text-muted-foreground')}
              >
                {instructions.length.toLocaleString()} /{' '}
                {DAILY_BRIEF_INSTRUCTIONS_LIMIT.toLocaleString()}
              </p>
            </div>
          </div>

          <div className='rounded-lg border border-border bg-muted/40 p-4'>
            <p className='text-sm font-medium text-foreground'>What your instructions can change</p>
            <ul className='mt-2 space-y-1.5'>
              {CAN_DO.map(item => (
                <li key={item} className='flex gap-2 text-sm text-muted-foreground'>
                  <span aria-hidden>•</span>
                  <span className='min-w-0'>{item}</span>
                </li>
              ))}
            </ul>
            <p className='mt-3 text-sm text-muted-foreground'>
              They can’t add, rename or reorder sections, and the brief always stays grounded in
              your workspace — it won’t invent anything.
            </p>
          </div>
        </div>

        <div className='mt-6 border-t border-border pt-2'>
          {busy && (
            <p className='mr-auto text-xs text-muted-foreground grow text-end'>
              A brief is already generating — save now, regenerate once it finishes.
            </p>
          )}
          <div className='flex items-center justify-end gap-3 pt-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={saving}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-settings-cancel'
              className='rounded-lg'
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => void handleSaveAndRegenerate()}
              disabled={loading || saving || overLimit || busy}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-settings-save-regenerate'
              className='rounded-lg'
            >
              Save & regenerate
            </Button>
            <Button
              type='button'
              onClick={() => void handleSave()}
              disabled={loading || saving || overLimit}
              loading={saving}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-settings-save'
              className='rounded-lg'
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
