import { useEffect, useRef, useState, type RefObject } from 'react';
import type { UseAudioPlaybackReturn } from '../../components/ui/AudioPlayer/useAudioPlayback';

export type RecordingVideoSource =
  | { status: 'loading' }
  | { status: 'ready'; kind: 'stream'; attachmentId: string }
  | { status: 'ready'; kind: 'file'; file: File }
  | { status: 'failed' };

export type ReadyRecordingVideoSource = Extract<RecordingVideoSource, { status: 'ready' }>;

type RecordingLoader = (signal: AbortSignal) => Promise<Blob>;

interface UseRecordingVideoOptions {
  isAvailable: boolean;
  title: string;
  /** Streams the recording when set; otherwise it is downloaded with `onLoad`. */
  attachmentId: string | null;
  onLoad: RecordingLoader | undefined;
  playback: UseAudioPlaybackReturn;
}

export interface RecordingVideo {
  isAvailable: boolean;
  isOpen: boolean;
  source: RecordingVideoSource;
  inlineRef: RefObject<HTMLVideoElement | null>;
  inlineStartSec: number;
  dialogStartSec: number | null;
  toggle: () => void;
  openDialog: () => void;
  closeDialog: (currentTime: number) => void;
  /** Seeks the shown video; returns false when there is none, so the audio should seek. */
  seek: (seconds: number) => boolean;
}

/** Downloads the recording once, the first time `enabled` is true, and keeps it. */
const useDownloadedVideo = (
  onLoad: RecordingLoader | undefined,
  enabled: boolean,
  title: string,
): RecordingVideoSource => {
  const [video, setVideo] = useState<RecordingVideoSource>({ status: 'loading' });
  // The loader is recreated on every parent render; read the latest without re-downloading.
  const latest = useRef({ onLoad, title });
  useEffect(() => {
    latest.current = { onLoad, title };
  });

  const hasFile = video.status === 'ready';

  useEffect(() => {
    const { onLoad: load, title: name } = latest.current;
    if (!enabled || hasFile || !load) return;

    const controller = new AbortController();
    setVideo({ status: 'loading' });
    load(controller.signal)
      .then(blob => {
        const file = new File([blob], `${name}.mp4`, { type: blob.type || 'video/mp4' });
        setVideo({ status: 'ready', kind: 'file', file });
      })
      .catch(() => {
        if (!controller.signal.aborted) setVideo({ status: 'failed' });
      });

    return (): void => controller.abort();
  }, [enabled, hasFile]);

  return video;
};

/** Hands playback between the timeline audio, the inline video and the expanded dialog. */
export const useRecordingVideo = ({
  isAvailable,
  title,
  attachmentId,
  onLoad,
  playback,
}: UseRecordingVideoOptions): RecordingVideo => {
  const [isOpen, setIsOpen] = useState(false);
  const [inlineStartSec, setInlineStartSec] = useState(0);
  const [dialogStartSec, setDialogStartSec] = useState<number | null>(null);
  const inlineRef = useRef<HTMLVideoElement>(null);
  const isShown = isAvailable && isOpen;
  const downloaded = useDownloadedVideo(onLoad, isShown && !attachmentId, title);
  const source: RecordingVideoSource = attachmentId
    ? { status: 'ready', kind: 'stream', attachmentId }
    : downloaded;

  const toggle = (): void => {
    if (isOpen) {
      const time = inlineRef.current?.currentTime;
      if (time !== undefined && playback.canSeek) playback.seek(time);
      setIsOpen(false);
      return;
    }

    if (playback.state === 'playing') void playback.toggle();
    setInlineStartSec(playback.currentTime);
    setIsOpen(true);
  };

  const openDialog = (): void => {
    const video = inlineRef.current;
    video?.pause();
    setDialogStartSec(video?.currentTime ?? inlineStartSec);
  };

  const closeDialog = (currentTime: number): void => {
    setDialogStartSec(null);
    if (inlineRef.current) inlineRef.current.currentTime = currentTime;
  };

  const seek = (seconds: number): boolean => {
    const video = isShown ? inlineRef.current : null;
    if (!video) return false;
    video.currentTime = seconds;
    return true;
  };

  return {
    isAvailable,
    isOpen: isShown,
    source,
    inlineRef,
    inlineStartSec,
    dialogStartSec,
    toggle,
    openDialog,
    closeDialog,
    seek,
  };
};
