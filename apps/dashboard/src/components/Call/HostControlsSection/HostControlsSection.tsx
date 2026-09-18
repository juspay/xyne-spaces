import { useState, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { Mic, Video, MonitorUp } from 'lucide-react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { callService } from '../../../services/Call/callService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Switch } from '../../ui/Switch';
import { logger, Event } from '../../../utils/logger';

interface HostControlsSectionProps {
  callId: string;
}

type HostControlKey = 'turnOffAudio' | 'turnOffCamera' | 'turnOffScreenShare';

interface HostControlRow {
  key: HostControlKey;
  title: string;
  MediaIcon: typeof Mic;
  track: string;
}

// Worded the way Meet does ("Let everyone…"): switch ON means allowed. The
// stored flags are the inverse (`turnOff*` = blocked), so the switch negates them.
const HOST_CONTROL_ROWS: HostControlRow[] = [
  {
    key: 'turnOffScreenShare',
    title: 'Share their screen',
    MediaIcon: MonitorUp,
    track: 'TURN_OFF_EVERYONE_SCREEN_SHARE',
  },
  {
    key: 'turnOffAudio',
    title: 'Turn on their microphone',
    MediaIcon: Mic,
    track: 'TURN_OFF_EVERYONE_AUDIO',
  },
  {
    key: 'turnOffCamera',
    title: 'Turn on their camera',
    MediaIcon: Video,
    track: 'TURN_OFF_EVERYONE_CAMERA',
  },
];

/** Number of meeting-wide restrictions the host currently has switched on. */
export function useActiveHostRestrictionCount(): number {
  const hostControls = useSelector(roomActor, state => state.context.hostControls);
  return HOST_CONTROL_ROWS.filter(row => hostControls[row.key]).length;
}

/** Host-only meeting restrictions, rendered inside the People panel. */
export function HostControlsSection({ callId }: HostControlsSectionProps): React.ReactElement {
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
        logger.error(Event.API_CALL_FAILED, {
          callId,
          context: 'HostControlsSection.updateHostControls',
          hostControl: key,
          enabled: next,
          error: error instanceof Error ? error.message : String(error),
        });
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
    <div className='pb-2'>
      <p className='px-4 pb-2 text-xs text-muted-foreground'>
        Let everyone (except you, the host):
      </p>
      {HOST_CONTROL_ROWS.map(row => {
        const { key, title, track } = row;
        const MediaIcon = row.MediaIcon;
        const turnedOff = hostControls[key];
        return (
          <label
            key={key}
            htmlFor={`host-control-${key}`}
            className='flex cursor-pointer items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-muted/60'
            data-testid={`host-control-row-${key}`}
          >
            <span className='flex min-w-0 items-center gap-3'>
              <MediaIcon size={18} className='flex-shrink-0 text-muted-foreground' />
              <span className='text-sm'>{title}</span>
            </span>
            <span
              className='flex-shrink-0'
              data-testid={`host-control-toggle-${key}`}
              data-track-category='CALLS'
              data-track-name={track}
              data-track-metadata={JSON.stringify({ callId, turnedOff: !turnedOff })}
            >
              <Switch
                checked={!turnedOff}
                onCheckedChange={allowed => void handleToggle(key, !allowed)}
                disabled={updatingKey !== null}
                aria-label={`Let everyone ${title.toLowerCase()}`}
                id={`host-control-${key}`}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
