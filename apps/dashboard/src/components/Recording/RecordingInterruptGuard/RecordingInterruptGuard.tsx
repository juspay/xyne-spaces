import { ReactElement, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { recordingStore } from '../../../stores/recordingStore';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import {
  getRecordingStatus,
  stopRecordingForNavigation,
  useRecordingStore,
} from '../../../hooks/useRecordingStore';

const DISCONNECT_TIMEOUT_MS = 3000;

export type RecordingInterruptReason = 'workspaceSwitch' | 'reload';

const COPY: Record<RecordingInterruptReason, { title: string; body: string; proceed: string }> = {
  workspaceSwitch: {
    title: 'Switching workspace will stop your recording',
    body: 'Switching reloads the app, which ends this recording. Everything captured so far is saved to your recordings.',
    proceed: 'Stop and switch',
  },
  reload: {
    title: 'Reloading will stop your recording',
    body: 'Reloading ends this recording. Everything captured so far is saved to your recordings.',
    proceed: 'Stop and reload',
  },
};

let openGuard:
  | ((reason: RecordingInterruptReason, resolve: (proceed: boolean) => void) => void)
  | null = null;

export function isRecordingInterruptible(): boolean {
  const status = getRecordingStatus();
  return status === 'starting' || status === 'recording' || status === 'paused';
}

export async function confirmRecordingInterrupt(
  reason: RecordingInterruptReason,
): Promise<boolean> {
  if (!isRecordingInterruptible()) return true;

  const open = openGuard;
  if (!open) return true;

  return new Promise<boolean>(resolve => open(reason, resolve));
}

async function stopActiveRecording(): Promise<void> {
  const { room } = recordingStore.getSnapshot().context;
  stopRecordingForNavigation();

  if (!room || room.state === ConnectionState.Disconnected) return;

  await new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      room.off(RoomEvent.Disconnected, finish);
      resolve();
    };
    timer = setTimeout(finish, DISCONNECT_TIMEOUT_MS);
    room.on(RoomEvent.Disconnected, finish);
  });
}

function StatusDot({ status }: { status: string }): ReactElement {
  if (status === 'paused') {
    return <span className='inline-flex size-2 rounded-full bg-amber-500' />;
  }
  if (status === 'starting') {
    return <span className='inline-flex size-2 animate-pulse rounded-full bg-blue-500' />;
  }
  return (
    <span className='relative inline-flex size-2'>
      <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75' />
      <span className='relative inline-flex size-2 rounded-full bg-red-500' />
    </span>
  );
}

export function RecordingInterruptGuard(): ReactElement | null {
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);
  const [reason, setReason] = useState<RecordingInterruptReason | null>(null);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();

  const status = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const pauseStartedAt = useRecordingStore(ctx => ctx.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(ctx => ctx.accumulatedPausedMs);

  useEffect(() => {
    openGuard = (nextReason, resolve): void => {
      if (resolverRef.current) {
        resolve(false);
        return;
      }
      resolverRef.current = resolve;
      setNow(Date.now());
      setReason(nextReason);
    };
    return (): void => {
      openGuard = null;
    };
  }, []);

  useEffect(() => {
    if (!reason || status !== 'recording') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(id);
  }, [reason, status]);

  if (!reason) return null;

  const copy = COPY[reason];
  const isPaused = status === 'paused';
  const elapsed = formatElapsedTime(
    calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs, now),
  );

  const settle = (proceed: boolean): void => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setReason(null);
    setStopping(false);
    resolve?.(proceed);
  };

  const handleStop = (): void => {
    setStopping(true);
    void stopActiveRecording().then(() => settle(true));
  };

  const enter = (index: number): Record<string, unknown> =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 4 },
          animate: { opacity: 1, y: 0 },
          transition: { type: 'spring', duration: 0.3, bounce: 0, delay: 0.04 * index },
        };

  return (
    <Dialog
      open
      onOpenChange={(open): void => {
        if (!open) settle(false);
      }}
      title={copy.title}
      description={copy.body}
      testId='recording-interrupt-guard'
      className='max-w-[460px] overflow-hidden rounded-xl'
    >
      <div className='px-5 pb-5 pt-5'>
        <motion.div
          {...enter(0)}
          className='inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 py-1 pl-2.5 pr-3'
        >
          <StatusDot status={status} />
          <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {status === 'starting' ? 'Starting' : isPaused ? 'Paused' : 'Recording'}
          </span>
          {status !== 'starting' && (
            <span className='text-[11px] font-semibold tabular-nums text-foreground'>
              {elapsed}
            </span>
          )}
        </motion.div>

        <motion.h2
          {...enter(1)}
          className='mt-3.5 text-balance text-[17px] font-semibold leading-snug tracking-[-0.01em] text-foreground'
        >
          {copy.title}
        </motion.h2>

        <motion.p
          {...enter(2)}
          className='mt-2 text-pretty text-[13px] leading-relaxed text-muted-foreground'
        >
          {copy.body}
        </motion.p>
      </div>

      <motion.div
        {...enter(3)}
        className='flex flex-col-reverse gap-2 border-t border-border/60 bg-muted/30 px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'
      >
        <Button
          variant='ghost'
          onClick={(): void => settle(false)}
          data-track-category='RecordingsV2'
          data-track-name='RECORDING_INTERRUPT_KEEP'
          disabled={stopping}
          className='w-full shrink-0 active:scale-[0.96] sm:w-auto'
          data-testid='recording-interrupt-keep'
        >
          Keep recording
        </Button>

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <Button
            variant='destructive'
            onClick={handleStop}
            data-track-category='RecordingsV2'
            data-track-name='RECORDING_INTERRUPT_STOP'
            loading={stopping}
            disabled={stopping}
            className='w-full shrink-0 active:scale-[0.96] sm:w-auto'
            data-testid='recording-interrupt-stop'
          >
            {stopping ? 'Stopping' : copy.proceed}
          </Button>
        </div>
      </motion.div>
    </Dialog>
  );
}
