import { useEffect, useRef } from 'react';
import { AlertTriangle, Info, Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { IncomingCallContextLine } from '../../components/Call/IncomingCall/IncomingCallContextLine';
import type { IncomingCallContextVM } from '../../components/Call/IncomingCall/IncomingCallCard.types';
import type { DeviceKind, LobbyPreviewState } from './useLobbyPreview';

interface CallLobbyProps {
  title: string;
  windowLine: string;
  subtitle?: string | null | undefined;
  context?: IncomingCallContextVM | null | undefined;
  status?: string | null | undefined;
  error?: string | null | undefined;
  preview: LobbyPreviewState;
  rememberChoice: boolean;
  onRememberChoiceChange: (value: boolean) => void;
  joinLabel: string;
  joinDisabled: boolean;
  cancelLabel: string;
  isRinging: boolean;
  onJoin: () => void;
  onCancel: () => void;
}

type NoticeTone = 'warning' | 'danger' | 'info';

function LobbyNotice({
  tone,
  children,
  action,
}: {
  tone: NoticeTone;
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        tone === 'danger' && 'border-destructive/30 bg-destructive/10',
        tone === 'warning' && 'border-[var(--call-notice-icon)]/40 bg-[var(--call-notice-icon)]/10',
        tone === 'info' && 'border-border bg-muted/40',
      )}
    >
      <Icon
        size={14}
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'danger' && 'text-destructive',
          tone === 'warning' && 'text-[var(--call-notice-icon)]',
          tone === 'info' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className='flex-1 text-foreground'>{children}</span>
      {action}
    </div>
  );
}

function PermissionNotice({
  kind,
  onOpenSettings,
}: {
  kind: DeviceKind;
  onOpenSettings: (kind: DeviceKind) => void;
}): React.ReactElement {
  return (
    <LobbyNotice
      tone='warning'
      action={
        <button
          type='button'
          onClick={() => onOpenSettings(kind)}
          className='shrink-0 font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          data-track-category='CALLS'
          data-track-name='Lobby_Open_System_Settings'
        >
          Open Settings
        </button>
      }
    >
      {kind === 'mic' ? 'Microphone' : 'Camera'} access is blocked.
    </LobbyNotice>
  );
}

function DeviceRow({
  icon: Icon,
  label,
  devices,
  currentDeviceId,
  onChange,
  fallbackLabel,
}: {
  icon: React.ElementType;
  label: string;
  devices: MediaDeviceInfo[];
  currentDeviceId: string | null;
  onChange: (deviceId: string) => void;
  fallbackLabel: string;
}): React.ReactElement {
  const hasDevices = devices.length > 0;
  return (
    <label className='flex items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring/50'>
      <Icon size={15} className='shrink-0 text-muted-foreground' aria-hidden />
      <span className='sr-only'>{label}</span>
      <select
        value={currentDeviceId ?? ''}
        onChange={event => onChange(event.target.value)}
        disabled={!hasDevices}
        aria-label={label}
        data-track-category='CALLS'
        data-track-name='Lobby_Select_Device'
        className='min-w-0 flex-1 truncate bg-transparent text-xs text-foreground outline-none disabled:text-muted-foreground'
      >
        {!currentDeviceId && <option value=''>{fallbackLabel}</option>}
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CallLobby({
  title,
  windowLine,
  subtitle,
  context,
  status,
  error,
  preview,
  rememberChoice,
  onRememberChoiceChange,
  joinLabel,
  joinDisabled,
  cancelLabel,
  isRinging,
  onJoin,
  onCancel,
}: CallLobbyProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    const track = preview.cameraTrack;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [preview.cameraTrack]);

  const micBlocked = preview.micPermission === 'denied';
  const cameraBlocked = preview.cameraPermission === 'denied';

  const toggleClass = (on: boolean): string =>
    cn(
      'flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      on
        ? 'bg-background/95 text-foreground hover:bg-background'
        : 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    );

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background text-foreground'>
      <div className='flex h-[52px] shrink-0 items-center pl-[92px] pr-4' style={APP_DRAG_STYLE}>
        <span className='truncate text-xs font-medium text-muted-foreground'>{windowLine}</span>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5 md:flex-row md:items-stretch'>
        <div className='relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted'>
          {preview.cameraOn && preview.cameraTrack ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className='h-full w-full scale-x-[-1] object-cover'
            />
          ) : (
            <div className='flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground'>
              <VideoOff size={26} />
              <span className='text-xs'>Camera is off</span>
            </div>
          )}

          <div
            className='absolute inset-x-0 bottom-3 flex items-center justify-center gap-3'
            style={APP_NO_DRAG_STYLE}
          >
            <button
              type='button'
              aria-label={preview.micOn ? 'Turn off microphone' : 'Turn on microphone'}
              aria-pressed={preview.micOn}
              onClick={() => preview.setMicOn(!preview.micOn)}
              data-track-category='CALLS'
              data-track-name='Lobby_Toggle_Mic'
              className={toggleClass(preview.micOn)}
            >
              {preview.micOn ? <Mic size={17} /> : <MicOff size={17} />}
            </button>
            <button
              type='button'
              aria-label={preview.cameraOn ? 'Turn off camera' : 'Turn on camera'}
              aria-pressed={preview.cameraOn}
              onClick={() => preview.setCameraOn(!preview.cameraOn)}
              data-track-category='CALLS'
              data-track-name='Lobby_Toggle_Camera'
              className={toggleClass(preview.cameraOn)}
            >
              {preview.cameraOn ? <Video size={17} /> : <VideoOff size={17} />}
            </button>
          </div>
        </div>

        <div
          className='flex min-h-0 w-full shrink-0 flex-col md:w-[290px]'
          style={APP_NO_DRAG_STYLE}
        >
          <div className='flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto'>
            <div>
              {context && (
                <div className='mb-1 [&>div]:mx-0 [&>div]:text-left'>
                  <IncomingCallContextLine context={context} />
                </div>
              )}
              <h1 className='truncate text-lg font-semibold leading-tight'>{title}</h1>
              {subtitle && (
                <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>{subtitle}</p>
              )}
            </div>

            {error && <LobbyNotice tone='danger'>{error}</LobbyNotice>}
            {status && <LobbyNotice tone='info'>{status}</LobbyNotice>}

            {micBlocked && (
              <PermissionNotice kind='mic' onOpenSettings={preview.openSystemSettings} />
            )}
            {cameraBlocked && (
              <PermissionNotice kind='camera' onOpenSettings={preview.openSystemSettings} />
            )}

            <div className='flex flex-col gap-1.5'>
              <DeviceRow
                icon={Mic}
                label='Microphone'
                devices={preview.micDevices}
                currentDeviceId={preview.micDeviceId}
                onChange={preview.selectMicDevice}
                fallbackLabel='Default microphone'
              />
              <DeviceRow
                icon={Volume2}
                label='Speaker'
                devices={preview.speakerDevices}
                currentDeviceId={preview.speakerDeviceId}
                onChange={preview.selectSpeakerDevice}
                fallbackLabel='Default speaker'
              />
              <DeviceRow
                icon={Video}
                label='Camera'
                devices={preview.cameraDevices}
                currentDeviceId={preview.cameraDeviceId}
                onChange={preview.selectCameraDevice}
                fallbackLabel='Default camera'
              />
            </div>

            <div className='flex items-center justify-between gap-3'>
              <span className='text-xs text-muted-foreground'>Remember these settings</span>
              <Switch
                checked={rememberChoice}
                onCheckedChange={onRememberChoiceChange}
                aria-label='Remember these settings'
              />
            </div>
          </div>

          <div className='mt-3 flex shrink-0 items-center gap-2'>
            <button
              type='button'
              onClick={onJoin}
              disabled={joinDisabled}
              data-track-category='CALLS'
              data-track-name={isRinging ? 'Lobby_Answer' : 'Lobby_Join'}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold',
                'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                'disabled:pointer-events-none disabled:opacity-50',
                isRinging
                  ? 'bg-[var(--call-accept-bg)] text-[var(--call-accept-fg)] hover:bg-[var(--call-accept-bg-hover)] active:bg-[var(--call-accept-bg-active)]'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {joinLabel}
            </button>
            {isRinging ? (
              <button
                type='button'
                onClick={onCancel}
                data-track-category='CALLS'
                data-track-name='Lobby_Decline'
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  'bg-[var(--call-decline-bg)] text-[var(--call-decline-fg)]',
                  'hover:bg-[var(--call-decline-bg-hover)] active:bg-[var(--call-decline-bg-active)]',
                )}
              >
                {cancelLabel}
              </button>
            ) : (
              <Button
                variant='outline'
                onClick={onCancel}
                data-track-category='CALLS'
                data-track-name='Lobby_Cancel'
              >
                {cancelLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
