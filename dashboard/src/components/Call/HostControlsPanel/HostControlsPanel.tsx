import { useState, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { X, Mic, Video, MonitorUp, Lock, LockOpen, UserLock } from 'lucide-react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { callService } from '../../../services/Call/callService';
import { getApiErrorMessage } from '../../../utils/apiError';

interface HostControlsPanelProps {
  callId: string;
  onClose: () => void;
}

type LockKey = 'lockMic' | 'lockCamera' | 'lockScreenShare';

interface LockRow {
  key: LockKey;
  title: string;
  description: string;
  MediaIcon: typeof Mic;
  track: string;
}

const LOCK_ROWS: LockRow[] = [
  {
    key: 'lockMic',
    title: 'Microphone',
    description: 'Participants cannot unmute themselves.',
    MediaIcon: Mic,
    track: 'LOCK_MIC',
  },
  {
    key: 'lockCamera',
    title: 'Camera',
    description: 'Participants cannot turn on their camera.',
    MediaIcon: Video,
    track: 'LOCK_CAMERA',
  },
  {
    key: 'lockScreenShare',
    title: 'Screen share',
    description: 'Participants cannot share their screen.',
    MediaIcon: MonitorUp,
    track: 'LOCK_SCREEN_SHARE',
  },
];

export function HostControlsPanel({ callId, onClose }: HostControlsPanelProps): React.ReactElement {
  const hostControls = useSelector(roomActor, state => state.context.hostControls);
  const [updatingKey, setUpdatingKey] = useState<LockKey | null>(null);

  const handleToggle = useCallback(
    async (key: LockKey, next: boolean) => {
      if (updatingKey) return;
      setUpdatingKey(key);
      try {
        const hostControls = await callService.setHostControls(callId, {
          [key]: next,
        });
        roomActor.send({ type: 'HOST_CONTROLS_CHANGED', hostControls });
      } catch (error) {
        console.error('[HostControlsPanel] Failed to update host controls:', error);
        toast.error('Failed to update host controls', {
          description: `${getApiErrorMessage(error, 'Please try again.')} Previous state was kept.`,
        });
      } finally {
        setUpdatingKey(null);
      }
    },
    [callId, updatingKey],
  );

  return (
    <div className='flex flex-col h-full bg-background text-foreground'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <div className='flex items-center gap-2'>
          <UserLock size={20} className='text-muted-foreground' />
          <h2 className='text-lg font-semibold'>Host controls</h2>
        </div>
        <button
          onClick={onClose}
          className='p-1 hover:bg-muted rounded-full transition-colors'
          title='Close'
          data-track-category='CALLS'
          data-track-name='CLOSE_HOST_CONTROLS'
        >
          <X size={20} className='text-muted-foreground' />
        </button>
      </div>

      <div className='flex-1 overflow-y-auto p-4 space-y-3'>
        <p className='text-xs text-muted-foreground'>
          Locks apply to everyone except you. Locked participants cannot turn the control back on.
        </p>
        {LOCK_ROWS.map(({ key, title, description, MediaIcon, track }) => {
          const locked = hostControls[key];
          const LockIcon = locked ? Lock : LockOpen;
          return (
            <div
              key={key}
              className='flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card'
              data-testid={`host-control-row-${key}`}
            >
              <div className='flex items-center gap-3 min-w-0'>
                <MediaIcon size={18} className='text-muted-foreground flex-shrink-0' />
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>{title}</p>
                  <p className='text-xs text-muted-foreground truncate'>{description}</p>
                </div>
              </div>
              <button
                onClick={() => void handleToggle(key, !locked)}
                disabled={updatingKey !== null}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ${
                  locked
                    ? 'bg-destructive/10 border-destructive/40 text-destructive'
                    : 'bg-background border-border text-foreground hover:bg-accent'
                }`}
                title={locked ? `Unlock ${title.toLowerCase()}` : `Lock ${title.toLowerCase()}`}
                data-testid={`host-control-toggle-${key}`}
                data-track-category='CALLS'
                data-track-name={track}
                data-track-metadata={JSON.stringify({ callId, locked: !locked })}
              >
                <LockIcon size={14} />
                <span>{locked ? 'Locked' : 'Unlocked'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
