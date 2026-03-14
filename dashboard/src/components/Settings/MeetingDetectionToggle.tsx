import { Switch } from '../ui/Switch';
import { useMeetingDetectionSettings } from '../../hooks/useMeetingDetectionSettings';

export function MeetingDetectionToggle() {
  const { meetingDetectionEnabled, toggleMeetingDetection } = useMeetingDetectionSettings();

  return (
    <div className='space-y-2'>
      <Switch
        id='meeting-detection'
        checked={meetingDetectionEnabled}
        onCheckedChange={toggleMeetingDetection}
        label='Meeting Detection'
      />
      <p className='text-xs text-muted-foreground pl-0.5'>
        Automatically prompts you to record when a meeting is detected
      </p>
    </div>
  );
}
