import { ReactElement, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarRange,
  MessageSquareText,
  ShieldCheck,
  Trash2,
} from '@/components/ClawAgents/digitalTwin/icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { DisableModal } from '@/components/ClawAgents/digitalTwin/DisableModal';
import {
  useClawDigitalTwinStatus,
  useDeleteDigitalTwinMemories,
  useUpdateDigitalTwinSettings,
} from '@/hooks/useClawDigitalTwin';
import {
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';

const MAX_SUFFIX_LEN = 500;
const MIN_SCORE = 0.7;
const MAX_SCORE = 1;
const SCORE_STEP = 0.05;

const DigitalTwinSettingsTab = (): ReactElement => {
  const reduceMotion = useReducedMotion();
  const { data: status, isLoading } = useClawDigitalTwinStatus();
  const update = useUpdateDigitalTwinSettings();
  const deleteMemories = useDeleteDigitalTwinMemories();
  const [suffix, setSuffix] = useState('');
  const [auto, setAuto] = useState(false);
  const [score, setScore] = useState(0.9);
  const [respondPolicy, setRespondPolicy] = useState<'always' | 'learned'>('always');
  const [deleteMode, setDeleteMode] = useState<'all' | 'range'>('range');
  const [deleteFrom, setDeleteFrom] = useState('');
  const [deleteTo, setDeleteTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  const initialSuffix = status?.responseSuffix ?? '';
  const initialAuto = status?.memoryApprovalMode === 'auto';
  const initialScore = status?.memoryAutoApproveMinScore ?? 0.9;
  const initialRespondPolicy = status?.respondPolicy === 'learned' ? 'learned' : 'always';

  useEffect(() => {
    setSuffix(initialSuffix);
    setAuto(initialAuto);
    setScore(initialScore);
    setRespondPolicy(initialRespondPolicy);
  }, [initialAuto, initialRespondPolicy, initialScore, initialSuffix]);

  const dirty =
    suffix.trim() !== initialSuffix.trim() ||
    auto !== initialAuto ||
    score !== initialScore ||
    respondPolicy !== initialRespondPolicy;
  const rangeInvalid =
    deleteMode === 'range' && (!deleteFrom || !deleteTo || deleteFrom > deleteTo);

  const save = (): void => {
    update.mutate(
      {
        responseSuffix: suffix || null,
        memoryApprovalMode: auto ? 'auto' : 'manual',
        memoryAutoApproveMinScore: score,
        respondPolicy,
      },
      { onSuccess: () => toast.success('Digital Twin settings saved') },
    );
  };

  if (isLoading && !status) {
    return (
      <div className='flex max-w-4xl flex-col gap-5'>
        <Skeleton className='h-56' />
        <Skeleton className='h-56' />
        <Skeleton className='h-56' />
      </div>
    );
  }

  return (
    <div className='flex max-w-5xl flex-col gap-5'>
      <div>
        <h2 className='text-lg font-semibold text-foreground'>Decide how your Twin behaves</h2>
        <p className='mt-1 max-w-[68ch] text-sm text-muted-foreground'>
          Reply behavior and memory approval change future actions. Your existing memories stay
          untouched until you explicitly delete them.
        </p>
      </div>

      <section className='grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[220px_minmax(0,1fr)]'>
        <div>
          <MessageSquareText className='size-5 text-muted-foreground' />
          <h3 className='mt-3 text-sm font-semibold text-foreground'>Reply behavior</h3>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            Choose when the Twin drafts a reply and how those replies identify themselves.
          </p>
        </div>

        <div className='flex flex-col gap-7'>
          <fieldset>
            <legend className='text-sm font-medium text-foreground'>When mentioned</legend>
            <div className='mt-3 grid gap-2 sm:grid-cols-2'>
              {[
                {
                  value: 'always' as const,
                  title: 'Always draft a reply',
                  body: 'Every direct mention can receive a memory-grounded response.',
                },
                {
                  value: 'learned' as const,
                  title: 'Follow my learned patterns',
                  body: 'The Twin may stay silent when your past behavior strongly suggests you would.',
                },
              ].map(option => (
                <label
                  key={option.value}
                  className={
                    respondPolicy === option.value
                      ? 'flex min-h-28 cursor-pointer gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4'
                      : 'flex min-h-28 cursor-pointer gap-3 rounded-lg border border-border bg-background p-4'
                  }
                >
                  <input
                    type='radio'
                    name='respond-policy'
                    value={option.value}
                    checked={respondPolicy === option.value}
                    onChange={() => setRespondPolicy(option.value)}
                    aria-label={`${option.title}: ${option.body}`}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin change reply policy'
                    className='mt-1 size-4 accent-primary'
                  />
                  <span>
                    <span className='block text-sm font-medium text-foreground'>
                      {option.title}
                    </span>
                    <span className='mt-1 block text-xs leading-5 text-muted-foreground'>
                      {option.body}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className='mt-3 text-xs leading-5 text-muted-foreground'>
              Example: “Can you confirm the rollout decision?” drafts a reply in either mode. “FYI —
              tagging you for visibility” may stay unanswered in learned mode when that matches your
              past behavior.
            </p>
          </fieldset>

          <label className='block'>
            <span className='text-sm font-medium text-foreground'>Response suffix</span>
            <span className='mt-1 block text-xs text-muted-foreground'>
              Optional disclosure appended to each reply sent on your behalf.
            </span>
            <textarea
              value={suffix}
              onChange={event => setSuffix(event.target.value.slice(0, MAX_SUFFIX_LEN))}
              placeholder='— Sent by my Digital Twin · may contain mistakes'
              rows={3}
              maxLength={MAX_SUFFIX_LEN}
              className='mt-3 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/10'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin response suffix'
            />
            <span className='mt-2 block text-right text-xs tabular-nums text-muted-foreground'>
              {suffix.length} / {MAX_SUFFIX_LEN}
            </span>
          </label>

          <AnimatePresence initial={false}>
            {suffix.trim() && (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                className='rounded-lg border border-border bg-muted/20 px-4 py-4'
              >
                <p className='text-sm font-medium text-foreground'>Reply preview</p>
                <p className='mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground'>
                  [A memory-grounded reply from your Twin]
                  {'\n\n'}
                  <span className='text-primary'>{suffix.trim()}</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className='grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[220px_minmax(0,1fr)]'>
        <div>
          <ShieldCheck className='size-5 text-muted-foreground' />
          <h3 className='mt-3 text-sm font-semibold text-foreground'>Memory approval</h3>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            Manual review is safest. Auto-approval can reduce routine review when curator confidence
            is high.
          </p>
        </div>

        <div className='flex flex-col gap-5'>
          <div className='flex min-h-16 items-start justify-between gap-5'>
            <div>
              <p className='text-sm font-medium text-foreground'>Auto-approve strong proposals</p>
              <p className='mt-1 max-w-[60ch] text-xs leading-5 text-muted-foreground'>
                Lower-confidence proposals always remain in Review.
              </p>
            </div>
            <Switch
              id='digital-twin-auto-approve'
              checked={auto}
              onCheckedChange={setAuto}
              aria-label='Auto-approve high-confidence memories'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin toggle automatic approval'
            />
          </div>

          <fieldset
            disabled={!auto}
            className='rounded-lg border border-border bg-muted/20 px-4 py-4 disabled:opacity-45'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <label htmlFor='dt-confidence' className='text-sm font-medium text-foreground'>
                Minimum curator confidence
              </label>
              <Input
                type='number'
                min={MIN_SCORE}
                max={MAX_SCORE}
                step={SCORE_STEP}
                value={score}
                onChange={event =>
                  setScore(
                    Math.min(
                      MAX_SCORE,
                      Math.max(MIN_SCORE, Number(event.target.value) || MIN_SCORE),
                    ),
                  )
                }
                className='w-24 text-right font-medium tabular-nums'
                aria-label='Minimum auto-approval confidence'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin set approval confidence'
              />
            </div>
            <input
              id='dt-confidence'
              type='range'
              min={MIN_SCORE}
              max={MAX_SCORE}
              step={SCORE_STEP}
              value={score}
              onChange={event => setScore(Number(event.target.value))}
              className='mt-5 w-full accent-primary'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin slide approval confidence'
            />
            <div className='mt-2 flex justify-between text-xs text-muted-foreground'>
              <span>0.70 · more memories</span>
              <span>1.00 · only the surest</span>
            </div>
          </fieldset>
        </div>
      </section>

      <div className='sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-sm'>
        <Button
          size='sm'
          loading={update.isPending}
          disabled={!dirty}
          onClick={save}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin save behavior'
        >
          Save behavior
        </Button>
        <span className='text-xs text-muted-foreground' aria-live='polite'>
          {dirty ? 'Unsaved behavior changes' : 'Behavior settings are up to date'}
        </span>
      </div>

      <section className='grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[220px_minmax(0,1fr)]'>
        <div>
          <CalendarRange className='size-5 text-muted-foreground' />
          <h3 className='mt-3 text-sm font-semibold text-foreground'>Data controls</h3>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            Memory deletion runs in the background. Disabling the Twin is a separate choice.
          </p>
        </div>

        <div className='flex flex-col gap-6'>
          <AnimatePresence initial={false}>
            {status?.memoryDeleteInProgress && (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                className='flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-foreground'
                aria-live='polite'
              >
                <AlertTriangle className='mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300' />
                Memory deletion is in progress. You may leave this page; the status will remain
                visible in the Digital Twin header.
              </motion.div>
            )}
          </AnimatePresence>

          <fieldset disabled={status?.memoryDeleteInProgress}>
            <legend className='text-sm font-medium text-foreground'>Delete memories</legend>
            <div className='mt-3 flex flex-wrap gap-5'>
              <label className='flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground'>
                <input
                  type='radio'
                  name='delete-mode'
                  checked={deleteMode === 'range'}
                  onChange={() => setDeleteMode('range')}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin select range deletion'
                  className='size-4 accent-destructive'
                />
                Date range
              </label>
              <label className='flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground'>
                <input
                  type='radio'
                  name='delete-mode'
                  checked={deleteMode === 'all'}
                  onChange={() => setDeleteMode('all')}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin select all deletion'
                  className='size-4 accent-destructive'
                />
                Everything
              </label>
            </div>

            <AnimatePresence initial={false}>
              {deleteMode === 'range' && (
                <motion.div
                  className='mt-4 grid gap-3 sm:grid-cols-2'
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                >
                  <label htmlFor='digital-twin-delete-from'>
                    <span className='mb-1.5 block text-xs font-medium text-foreground'>From</span>
                    <Input
                      id='digital-twin-delete-from'
                      type='date'
                      value={deleteFrom}
                      max={deleteTo || undefined}
                      onChange={event => setDeleteFrom(event.target.value)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin set delete from date'
                    />
                  </label>
                  <label htmlFor='digital-twin-delete-to'>
                    <span className='mb-1.5 block text-xs font-medium text-foreground'>To</span>
                    <Input
                      id='digital-twin-delete-to'
                      type='date'
                      value={deleteTo}
                      min={deleteFrom || undefined}
                      onChange={event => setDeleteTo(event.target.value)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin set delete to date'
                    />
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              variant='outline'
              size='sm'
              className='mt-4 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
              disabled={rangeInvalid || status?.memoryDeleteInProgress}
              onClick={() => setConfirmDelete(true)}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin start memory deletion'
            >
              <Trash2 className='size-4' />
              {deleteMode === 'all' ? 'Delete all memories' : 'Delete memories in range'}
            </Button>
          </fieldset>

          <div className='border-t border-border pt-6'>
            <h4 className='text-sm font-medium text-foreground'>Disable Digital Twin</h4>
            <p className='mt-1 max-w-[62ch] text-xs leading-5 text-muted-foreground'>
              Stops replies and nightly learning. Your memories remain unless you separately choose
              to delete them.
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-4 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
              onClick={() => setShowDisable(true)}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin open disable confirmation'
            >
              Disable Twin
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        surface='digital-twin'
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={deleteMode === 'all' ? 'Delete every memory?' : 'Delete memories in this range?'}
        description={
          deleteMode === 'all'
            ? 'This removes the full approved memory ledger. Persona files are managed separately. This cannot be undone.'
            : `Memories created from ${deleteFrom} through ${deleteTo} will be removed. This cannot be undone.`
        }
        confirmLabel={deleteMode === 'all' ? 'Delete everything' : 'Delete range'}
        danger
        loading={deleteMemories.isPending}
        onConfirm={() =>
          deleteMemories.mutate(
            deleteMode === 'all'
              ? { mode: 'all' }
              : {
                  mode: 'range',
                  from: `${deleteFrom}T00:00:00.000Z`,
                  to: `${deleteTo}T23:59:59.999Z`,
                },
            { onSuccess: () => setConfirmDelete(false) },
          )
        }
      />

      <DisableModal open={showDisable} onClose={() => setShowDisable(false)} />
    </div>
  );
};

export default DigitalTwinSettingsTab;
