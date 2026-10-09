import { ReactElement, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import { recordingStore } from '../../stores/recordingStore';
import { roomActor } from '../../machines/roomMachine';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../utils/recordingUtils';
import {
  getRecordingStatus,
  stopRecordingForNavigation,
  useRecordingStore,
} from '../../hooks/useRecordingStore';

const DISCONNECT_TIMEOUT_MS = 3000;

export type InterruptReason = 'workspaceSwitch' | 'reload';
export type InterruptSource = 'recording' | 'call';
type InterruptSubject = InterruptSource | 'both';

const COPY: Record<InterruptSubject, Record<InterruptReason, Copy>> = {
  recording: {
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
  },
  call: {
    workspaceSwitch: {
      title: 'Switching workspace will end your call',
      body: 'Switching reloads the app, which drops you from this call. Everyone else stays on, and you can rejoin from the channel.',
      proceed: 'Leave and switch',
    },
    reload: {
      title: 'Reloading will end your call',
      body: 'Reloading drops you from this call. Everyone else stays on, and you can rejoin from the channel.',
      proceed: 'Leave and reload',
    },
  },
  both: {
    workspaceSwitch: {
      title: 'Switching workspace will end your call and stop your recording',
      body: 'Switching reloads the app, which drops you from this call and ends this recording. Everything captured so far is saved to your recordings.',
      proceed: 'End and switch',
    },
    reload: {
      title: 'Reloading will end your call and stop your recording',
      body: 'Reloading drops you from this call and ends this recording. Everything captured so far is saved to your recordings.',
      proceed: 'End and reload',
    },
  },
};

interface Copy {
  title: string;
  body: string;
  proceed: string;
}

let openGuard:
  | ((
      reason: InterruptReason,
      sources: InterruptSource[],
      resolve: (proceed: boolean) => void,
    ) => void)
  | null = null;

function isRecordingInterruptible(): boolean {
  const status = getRecordingStatus();
  return status === 'starting' || status === 'recording' || status === 'paused';
}

function isCallInterruptible(): boolean {
  const snapshot = roomActor.getSnapshot();
  return (
    snapshot.matches('initiating') ||
    snapshot.matches('joining') ||
    snapshot.matches('connecting') ||
    snapshot.matches('connected')
  );
}

function getInterruptSources(): InterruptSource[] {
  const sources: InterruptSource[] = [];
  if (isRecordingInterruptible()) sources.push('recording');
  if (isCallInterruptible()) sources.push('call');
  return sources;
}

export function isInterruptible(): boolean {
  return getInterruptSources().length > 0;
}

export async function confirmInterrupt(reason: InterruptReason): Promise<boolean> {
  const sources = getInterruptSources();
  if (sources.length === 0) return true;

  const open = openGuard;
  if (!open) return true;

  return new Promise<boolean>(resolve => open(reason, sources, resolve));
}

function subjectOf(sources: InterruptSource[]): InterruptSubject {
  if (sources.length > 1) return 'both';
  return sources[0] ?? 'recording';
}

async function waitForRoomDisconnect(room: Room | null): Promise<void> {
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

async function stopActiveRecording(): Promise<void> {
  const { room } = recordingStore.getSnapshot().context;
  stopRecordingForNavigation();
  await waitForRoomDisconnect(room);
}

async function stopActiveCall(): Promise<void> {
  if (roomActor.getSnapshot().matches('idle')) return;

  await new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
      resolve();
    };
    const subscription = roomActor.subscribe(state => {
      if (!state.matches('idle')) return;
      finish();
    });
    timer = setTimeout(finish, DISCONNECT_TIMEOUT_MS);
    roomActor.send({ type: 'DISCONNECT' });
  });
}

function StatusDot({ status }: { status: string }): ReactElement {
  if (status === 'paused') {
    return <span className='inline-flex size-2 rounded-full bg-amber-500' />;
  }
  if (status === 'starting') {
    return <span className='inline-flex size-2 animate-pulse rounded-full bg-blue-500' />;
  }
  if (status === 'call') {
    return <span className='inline-flex size-2 rounded-full bg-emerald-500' />;
  }
  return (
    <span className='relative inline-flex size-2'>
      <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75' />
      <span className='relative inline-flex size-2 rounded-full bg-red-500' />
    </span>
  );
}

export function InterruptGuard(): ReactElement | null {
  const resolverRef = useRef<((proceed: boolean) => void) | null>(null);
  const [reason, setReason] = useState<InterruptReason | null>(null);
  const [sources, setSources] = useState<InterruptSource[]>([]);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();

  const status = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const pauseStartedAt = useRecordingStore(ctx => ctx.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(ctx => ctx.accumulatedPausedMs);

  useEffect(() => {
    openGuard = (nextReason, nextSources, resolve): void => {
      if (resolverRef.current) {
        resolve(false);
        return;
      }
      resolverRef.current = resolve;
      setNow(Date.now());
      setSources(nextSources);
      setReason(nextReason);
    };
    return (): void => {
      openGuard = null;
    };
  }, []);

  const showsRecording = sources.includes('recording');
  const ticking = showsRecording ? status === 'recording' : sources.includes('call');

  useEffect(() => {
    if (!reason || !ticking) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(id);
  }, [reason, ticking]);

  if (!reason) return null;

  const subject = subjectOf(sources);
  const copy = COPY[subject][reason];
  const trackCategory = showsRecording ? 'RecordingsV2' : 'CALLS';
  const isPaused = status === 'paused';
  const callStartTime = roomActor.getSnapshot().context.callStartTime;
  const elapsed = showsRecording
    ? formatElapsedTime(
        calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs, now),
      )
    : formatElapsedTime(callStartTime ? now - callStartTime : 0);

  const chipLabel = showsRecording
    ? status === 'starting'
      ? 'Starting'
      : isPaused
        ? 'Paused'
        : 'Recording'
    : 'In call';
  const showElapsed = showsRecording ? status !== 'starting' : callStartTime !== null;

  const settle = (proceed: boolean): void => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setReason(null);
    setSources([]);
    setStopping(false);
    resolve?.(proceed);
  };

  const handleStop = (): void => {
    setStopping(true);
    const pending: Promise<void>[] = [];
    if (sources.includes('recording')) pending.push(stopActiveRecording());
    if (sources.includes('call')) pending.push(stopActiveCall());
    void Promise.all(pending).then(() => settle(true));
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
      testId='interrupt-guard'
      className='max-w-[460px] overflow-hidden rounded-xl'
    >
      <div className='px-5 pb-5 pt-5'>
        <motion.div
          {...enter(0)}
          className='inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 py-1 pl-2.5 pr-3'
        >
          <StatusDot status={showsRecording ? status : 'call'} />
          <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {chipLabel}
          </span>
          {showElapsed && (
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
          data-track-category={trackCategory}
          data-track-name='INTERRUPT_GUARD_KEEP'
          disabled={stopping}
          className='w-full shrink-0 active:scale-[0.96] sm:w-auto'
          data-testid='interrupt-guard-keep'
        >
          {subject === 'both' ? 'Keep both' : showsRecording ? 'Keep recording' : 'Stay on call'}
        </Button>

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <Button
            variant='destructive'
            onClick={handleStop}
            data-track-category={trackCategory}
            data-track-name='INTERRUPT_GUARD_STOP'
            loading={stopping}
            disabled={stopping}
            className='w-full shrink-0 active:scale-[0.96] sm:w-auto'
            data-testid='interrupt-guard-stop'
          >
            {stopping ? 'Stopping' : copy.proceed}
          </Button>
        </div>
      </motion.div>
    </Dialog>
  );
}
