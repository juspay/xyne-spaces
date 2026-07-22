import { useState, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { X, Mic, Video, MonitorUp, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { callService } from '../../../services/Call/callService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Switch } from '../../ui/Switch';

interface HostControlsPanelProps {
  callId: string;
  onClose: () => void;
}

type HostControlKey = 'turnOffAudio' | 'turnOffCamera' | 'turnOffScreenShare';

interface HostControlRow {
  key: HostControlKey;
  title: string;
  description: string;
  MediaIcon: typeof Mic;
  track: string;
}

const HOST_CONTROL_ROWS: HostControlRow[] = [
  {
    key: 'turnOffAudio',
    title: 'Prevent anyone from turning on their mic',
    description: 'Applies to everyone except you.',
    MediaIcon: Mic,
    track: 'TURN_OFF_EVERYONE_AUDIO',
  },
  {
    key: 'turnOffCamera',
    title: 'Prevent anyone from turning on their camera',
    description: 'Applies to everyone except you.',
    MediaIcon: Video,
    track: 'TURN_OFF_EVERYONE_CAMERA',
  },
  {
    key: 'turnOffScreenShare',
    title: 'Prevent anyone from sharing their screen',
    description: 'Applies to everyone except you.',
    MediaIcon: MonitorUp,
    track: 'TURN_OFF_EVERYONE_SCREEN_SHARE',
  },
];

export function HostControlsPanel({ callId, onClose }: HostControlsPanelProps): React.ReactElement {
  const hostControls = useSelector(roomActor, state => state.context.hostControls);
  const [updatingKey, setUpdatingKey] = useState<HostControlKey | null>(null);

  const handleToggle = useCallback(
    async (key: HostControlKey, next: boolean) => {
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
          <UserCog size={20} className='text-muted-foreground' />
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
          These controls apply to everyone except you.
        </p>
        {HOST_CONTROL_ROWS.map(row => {
          const { key, title, description, track } = row;
          const MediaIcon = row.MediaIcon;
          const turnedOff = hostControls[key];
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
              <div
                className='flex-shrink-0'
                title={title}
                data-testid={`host-control-toggle-${key}`}
                data-track-category='CALLS'
                data-track-name={track}
                data-track-metadata={JSON.stringify({ callId, turnedOff: !turnedOff })}
              >
                <Switch
                  checked={turnedOff}
                  onCheckedChange={next => void handleToggle(key, next)}
                  disabled={updatingKey !== null}
                  aria-label={title}
                  id={`host-control-${key}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
