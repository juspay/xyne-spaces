import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { DeviceIssue, MediaPreview } from './useMediaPreview';
import { Spinner } from './LobbyChrome';

// ---------------------------------------------------------------------------
// Preview tile
// ---------------------------------------------------------------------------

interface PreJoinPreviewProps {
  media: MediaPreview;
  displayName: string;
  /** Disable the toggles while a join is being negotiated. */
  locked?: boolean;
}

export function PreJoinPreview({ media, displayName, locked = false }: PreJoinPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { videoTrack } = media;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    el.srcObject = videoTrack ? new MediaStream([videoTrack]) : null;
    return () => {
      el.srcObject = null;
    };
  }, [videoTrack]);

  const name = displayName.trim();
  const showVideo = !!videoTrack;

  return (
    <div className='w-full'>
      <div className='relative aspect-video w-full overflow-hidden rounded-2xl bg-[#1e1f20] shadow-[0_1px_3px_rgba(0,0,0,0.3),0_4px_8px_3px_rgba(0,0,0,0.15)]'>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {!showVideo && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center'>
            {media.isCameraStarting ? (
              <>
                <Spinner />
                <p className='text-[15px] text-[#c4c7c5]'>Camera is starting</p>
              </>
            ) : (
              <>
                {name ? (
                  <div className='flex h-24 w-24 items-center justify-center rounded-full bg-[#a8c7fa] text-4xl font-medium text-[#062e6f] sm:h-28 sm:w-28'>
                    {name.charAt(0).toUpperCase()}
                  </div>
                ) : null}
                <p className='text-[15px] text-[#e3e3e3]'>{cameraOffMessage(media.camIssue)}</p>
              </>
            )}
          </div>
        )}

        {/* Gradient keeps the name + controls legible over bright video */}
        <div className='pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/50 to-transparent' />
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent' />

        {name && (
          <div className='absolute left-4 top-3 max-w-[70%] truncate text-sm font-medium text-white'>
            {name}
          </div>
        )}

        {media.micOn && media.audioTrack && (
          <div className='absolute bottom-4 left-4'>
            <AudioLevelIndicator track={media.audioTrack} />
          </div>
        )}

        <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-4'>
          <PreviewToggle
            on={media.micOn}
            issue={media.micIssue}
            disabled={locked}
            onClick={media.toggleMic}
            onIcon={<Mic size={22} />}
            offIcon={<MicOff size={22} />}
            label={media.micOn ? 'Turn off microphone' : 'Turn on microphone'}
            trackName='EXTERNAL_TOGGLE_MIC'
          />
          <PreviewToggle
            on={media.camOn}
            issue={media.camIssue}
            disabled={locked}
            onClick={media.toggleCam}
            onIcon={<Video size={22} />}
            offIcon={<VideoOff size={22} />}
            label={media.camOn ? 'Turn off camera' : 'Turn on camera'}
            trackName='EXTERNAL_TOGGLE_CAMERA'
          />
        </div>
      </div>

      <div className='mt-4 flex flex-wrap justify-center gap-2 sm:justify-start'>
        <DevicePicker
          icon={<Mic size={16} />}
          kindLabel='Microphone'
          devices={media.audioInputs}
          selectedId={media.audioDeviceId}
          onSelect={media.selectAudioDevice}
          disabled={locked}
        />
        <DevicePicker
          icon={<Video size={16} />}
          kindLabel='Camera'
          devices={media.videoInputs}
          selectedId={media.videoDeviceId}
          onSelect={media.selectVideoDevice}
          disabled={locked}
        />
      </div>
    </div>
  );
}

function cameraOffMessage(issue: DeviceIssue): string {
  switch (issue) {
    case 'blocked':
      return 'Camera is blocked';
    case 'in_use':
      return 'Camera is in use by another app';
    case 'missing':
      return 'No camera found';
    default:
      return 'Camera is off';
  }
}

// ---------------------------------------------------------------------------
// Round toggle
// ---------------------------------------------------------------------------

interface PreviewToggleProps {
  on: boolean;
  issue: DeviceIssue;
  disabled: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  label: string;
  trackName: string;
}

function PreviewToggle({ on, issue, disabled, onClick, onIcon, offIcon, label, trackName }: PreviewToggleProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={!on}
      title={issue === 'blocked' ? `${label} (access blocked)` : label}
      data-track-category='CALLS'
      data-track-name={trackName}
      className={`relative flex h-14 w-14 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60 ${
        on
          ? 'border border-white/70 bg-transparent text-white hover:bg-white/15'
          : 'bg-[#dc362e] text-white hover:bg-[#e3554e]'
      }`}
    >
      {on ? onIcon : offIcon}
      {issue && (
        <span className='absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#fcd663] text-[#1f1f1f] ring-2 ring-[#131314]'>
          <AlertTriangle size={11} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mic level — drives the DOM directly so 60fps updates don't re-render the page
// ---------------------------------------------------------------------------

function AudioLevelIndicator({ track }: { track: MediaStreamTrack }) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return undefined;

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    void ctx.resume().catch(() => undefined);

    const samples = new Uint8Array(analyser.fftSize);
    let level = 0;
    let frame = 0;
    const tick = (): void => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const v = (sample - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / samples.length);
      level = level * 0.75 + Math.min(1, rms * 5) * 0.25;
      // Middle bar leads, outer bars follow — the Meet "talking" shape.
      const heights = [0.55, 1, 0.55].map(w => 4 + level * w * 12);
      barsRef.current.forEach((bar, i) => {
        if (bar) bar.style.height = `${heights[i]}px`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [track]);

  return (
    <div
      className='flex h-8 w-8 items-center justify-center gap-[3px] rounded-full bg-[#a8c7fa]'
      aria-hidden='true'
    >
      {[0, 1, 2].map(i => (
        <span
          key={i}
          ref={el => {
            barsRef.current[i] = el;
          }}
          className='w-[4px] rounded-full bg-[#062e6f] transition-[height] duration-75'
          style={{ height: 4 }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device picker pill
// ---------------------------------------------------------------------------

interface DevicePickerProps {
  icon: React.ReactNode;
  kindLabel: string;
  devices: MediaDeviceInfo[];
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  disabled?: boolean;
}

function DevicePicker({ icon, kindLabel, devices, selectedId, onSelect, disabled }: DevicePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = devices.find(d => d.deviceId === selectedId) ?? devices[0];
  const isEmpty = devices.length === 0;

  return (
    <div className='relative' ref={rootRef}>
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        disabled={disabled || isEmpty}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-label={`${kindLabel}: ${selected?.label ?? 'none'}`}
        data-track-category='CALLS'
        data-track-name='EXTERNAL_DEVICE_PICKER'
        data-track-metadata={JSON.stringify({ deviceType: kindLabel })}
        className='flex h-9 max-w-[240px] items-center gap-2 rounded-full border border-white/15 px-3 text-[13px] text-[#e3e3e3] transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'
      >
        <span className='shrink-0 text-[#c4c7c5]'>{icon}</span>
        <span className='truncate'>{selected?.label ?? `No ${kindLabel.toLowerCase()}`}</span>
        {!isEmpty && (
          <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <ul
          role='listbox'
          aria-label={kindLabel}
          className='absolute left-0 top-full z-50 mt-2 max-h-64 min-w-[260px] max-w-[320px] overflow-y-auto rounded-xl bg-[#1e1f20] py-1.5 shadow-2xl ring-1 ring-white/10 animate-in fade-in-0 zoom-in-95 duration-100'
        >
          {devices.map(device => {
            const isSelected = device.deviceId === selected?.deviceId;
            return (
              <li key={device.deviceId} role='option' aria-selected={isSelected}>
                <button
                  type='button'
                  onClick={() => {
                    onSelect(device.deviceId);
                    setOpen(false);
                  }}
                  data-track-category='CALLS'
                  data-track-name='EXTERNAL_SELECT_DEVICE'
                  data-track-metadata={JSON.stringify({ deviceType: kindLabel })}
                  className='flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#e3e3e3] hover:bg-white/10'
                >
                  <span className='w-4 shrink-0 text-[#a8c7fa]'>{isSelected && <Check size={16} />}</span>
                  <span className='truncate'>{device.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
