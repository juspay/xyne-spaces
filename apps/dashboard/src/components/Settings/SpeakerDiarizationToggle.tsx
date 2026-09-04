import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { useSpeakerDiarizationSettings } from '../../hooks/useSpeakerDiarizationSettings';
import type { SpeakerDiarizationStatus } from '../../types/electron';

const DOWNLOAD_TOAST_ID = 'speaker-diarization-download';

function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Progress toast body. Subscribes to main-process status itself so the toast
 * keeps updating even after the Preferences dialog is closed.
 */
function DownloadProgressToast({
  initial,
  onCancel,
}: {
  initial: SpeakerDiarizationStatus | null;
  onCancel: () => void;
}): ReactElement {
  const [status, setStatus] = useState<SpeakerDiarizationStatus | null>(initial);

  useEffect(() => {
    const api = window.electronAPI?.speakerDiarization;
    if (!api) return;
    return api.onStatusChanged(setStatus);
  }, []);

  const received = status?.download.receivedBytes ?? 0;
  const total = status?.download.totalBytes ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  return (
    <div className='w-[356px] rounded-xl border border-border bg-background p-4 shadow-lg'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-sm font-medium text-foreground'>Downloading speaker models</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            {formatMb(received)} of {formatMb(total)} · runs on your device, one-time download
          </p>
        </div>
        <button
          type='button'
          onClick={onCancel}
          data-track-category='Settings'
          data-track-name='speaker-diarization-cancel-download'
          className='shrink-0 text-xs text-muted-foreground hover:text-foreground'
        >
          Cancel
        </button>
      </div>
      <div
        className='mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label='Speaker model download progress'
      >
        <div
          className='h-full rounded-full bg-primary transition-[width] duration-200'
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Kick off the model download and show its progress in a toast. The same toast
 * id is reused so the progress card is replaced in place by the final
 * success / error toast.
 */
export async function runSpeakerModelDownload(
  downloadModels: () => Promise<{ ok: boolean; error?: string }>,
  cancelDownload: () => void,
  initialStatus: SpeakerDiarizationStatus | null,
): Promise<boolean> {
  toast.custom(() => <DownloadProgressToast initial={initialStatus} onCancel={cancelDownload} />, {
    id: DOWNLOAD_TOAST_ID,
    duration: Infinity,
  });

  const result = await downloadModels();
  if (result.ok) {
    toast.success('Speaker disambiguation is ready', {
      id: DOWNLOAD_TOAST_ID,
      description: 'Speakers will be identified on your device for every new recording.',
      duration: 5000,
    });
    return true;
  }

  const cancelled = result.error === 'Download cancelled';
  if (cancelled) {
    toast.info('Speaker model download cancelled', {
      id: DOWNLOAD_TOAST_ID,
      description: 'Turn the setting on again in Preferences to retry.',
      duration: 4000,
    });
  } else {
    toast.error('Speaker model download failed', {
      id: DOWNLOAD_TOAST_ID,
      description: result.error ?? 'Please check your connection and try again.',
      duration: 8000,
      action: {
        label: 'Retry',
        onClick: () => {
          void runSpeakerModelDownload(downloadModels, cancelDownload, initialStatus);
        },
      },
    });
  }
  return false;
}

/**
 * Preferences → Recordings: "Speaker disambiguation" (Electron only).
 * Turning it on downloads the Sherpa-ONNX models (progress shown in a toast);
 * once they are installed every note-taker recording is diarized on-device.
 */
export function SpeakerDiarizationToggle(): ReactElement | null {
  const { isSupported, status, setEnabled, downloadModels, cancelDownload } =
    useSpeakerDiarizationSettings();

  const startDownload = useCallback((): void => {
    void runSpeakerModelDownload(downloadModels, cancelDownload, status);
  }, [downloadModels, cancelDownload, status]);

  const handleToggle = useCallback(
    (checked: boolean): void => {
      setEnabled(checked);
      if (checked && status && !status.modelsReady && status.download.state !== 'downloading') {
        startDownload();
      }
      if (!checked) toast.dismiss(DOWNLOAD_TOAST_ID);
    },
    [setEnabled, status, startDownload],
  );

  if (!isSupported) return null;

  const enabled = status?.enabled ?? false;
  const modelsReady = status?.modelsReady ?? false;
  const downloading = status?.download.state === 'downloading';
  const downloadError = status?.download.state === 'error' ? status.download.error : null;
  const downloadSizeMb = status ? Math.round(status.download.totalBytes / 1_000_000) : null;

  let hint: string;
  if (!enabled) {
    hint = 'Off';
  } else if (modelsReady) {
    hint = status?.processing
      ? 'Identifying speakers in your last recording…'
      : 'On · models installed';
  } else if (downloading) {
    hint = 'Downloading models…';
  } else if (downloadError) {
    hint = `Download failed: ${downloadError}`;
  } else {
    hint = 'Models not installed yet';
  }

  return (
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div className='min-w-0'>
        <p className='text-sm font-medium text-foreground'>Speaker disambiguation</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Tell apart different voices in your recordings, labelled Speaker 1, Speaker 2, and so on.
          Runs entirely on this computer; a one-time {downloadSizeMb ? `${downloadSizeMb} MB ` : ''}
          model download is required.
        </p>
        <p className='text-xs text-muted-foreground mt-1' aria-live='polite'>
          {hint}
        </p>
        {enabled && !modelsReady && !downloading && (
          <Button
            size='sm'
            variant='outline'
            className='mt-2'
            onClick={startDownload}
            data-track-category='Settings'
            data-track-name='speaker-diarization-download-models'
          >
            {downloadError ? 'Retry download' : 'Download models'}
          </Button>
        )}
      </div>
      <Switch
        id='speaker-diarization'
        aria-label='Enable speaker disambiguation'
        checked={enabled}
        disabled={!status}
        onCheckedChange={handleToggle}
      />
    </div>
  );
}
