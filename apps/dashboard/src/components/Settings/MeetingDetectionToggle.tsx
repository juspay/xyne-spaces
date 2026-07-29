import { Switch } from '../ui/Switch';
import { useMeetingDetectionSettings } from '../../hooks/useMeetingDetectionSettings';

export function MeetingDetectionToggle() {
  const { meetingDetectionEnabled, toggleMeetingDetection } = useMeetingDetectionSettings();

  return (
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Meeting Detection</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Automatically prompts you to record when a meeting is detected
        </p>
      </div>
      <Switch
        id='meeting-detection'
        checked={meetingDetectionEnabled}
        onCheckedChange={toggleMeetingDetection}
      />
    </div>
  );
}
