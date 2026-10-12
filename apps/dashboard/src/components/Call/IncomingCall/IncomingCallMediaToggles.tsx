import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import { cn } from '../../../utils/classNames';

export interface IncomingCallMediaState {
  micOn: boolean;
  cameraOn: boolean;
  previewStream: MediaStream | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

interface IncomingCallMediaTogglesProps extends Omit<IncomingCallMediaState, 'previewStream'> {
  callId: string;
}

const TOGGLE =
  'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none p-0 ' +
  'transition-colors duration-[120ms] ease-out ' +
  'ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ON = 'bg-muted text-foreground hover:bg-accent';
const OFF = 'bg-transparent text-muted-foreground hover:bg-muted';

export function IncomingCallMediaToggles({
  callId,
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
}: IncomingCallMediaTogglesProps): ReactElement {
  const MicIcon = micOn ? Mic : MicOff;
  const CameraIcon = cameraOn ? Video : VideoOff;

  return (
    <div className='mb-5 flex items-center justify-center gap-3'>
      <button
        type='button'
        onClick={onToggleMic}
        aria-pressed={micOn}
        aria-label={micOn ? 'Turn off microphone' : 'Turn on microphone'}
        title={micOn ? 'Turn off microphone' : 'Turn on microphone'}
        className={cn(TOGGLE, micOn ? ON : OFF)}
        data-track-category='CALLS_NOTIFICATIONS'
        data-track-name='TOGGLE_INCOMING_CALL_MIC'
        data-track-metadata={JSON.stringify({ callId, enabled: !micOn })}
      >
        <MicIcon className='h-[18px] w-[18px]' />
      </button>
      <button
        type='button'
        onClick={onToggleCamera}
        aria-pressed={cameraOn}
        aria-label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
        title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
        className={cn(TOGGLE, cameraOn ? ON : OFF)}
        data-track-category='CALLS_NOTIFICATIONS'
        data-track-name='TOGGLE_INCOMING_CALL_CAMERA'
        data-track-metadata={JSON.stringify({ callId, enabled: !cameraOn })}
      >
        <CameraIcon className='h-[18px] w-[18px]' />
      </button>
    </div>
  );
}

export function IncomingCallCameraPreview({ stream }: { stream: MediaStream }): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className='mt-4 aspect-video w-[200px] -scale-x-100 rounded-xl bg-muted object-cover ring-1 ring-border'
    />
  );
}
