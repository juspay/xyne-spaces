import { forwardRef, useRef, type ReactElement } from 'react';
import { AlertTriangle, Spinner } from '@xyne/icons';
import { Video, VideoOff } from 'lucide-react';
import { Button } from '../../../components/ui/Button/Button';
import { Dialog } from '../../../components/ui/Dialog';
import VideoViewer from '../../../components/FileViewer/VideoViewer';
import useMeasure from '../../../hooks/useMeasure';
import type { ReadyRecordingVideoSource, RecordingVideoSource } from '../useRecordingVideo';

interface ViewerSourceProps {
  source: File | null;
  attachmentId?: string;
  fileName: string;
}

/** A stream plays straight from the attachment endpoint; a file plays from memory. */
const getViewerSourceProps = (
  video: ReadyRecordingVideoSource,
  title: string,
): ViewerSourceProps =>
  video.kind === 'stream'
    ? { source: null, attachmentId: video.attachmentId, fileName: `${title}.mp4` }
    : { source: video.file, fileName: video.file.name };

const VideoStatus = ({ failed }: { failed: boolean }): ReactElement => (
  <div className='flex h-full items-center justify-center gap-2 text-sm text-white/70'>
    {failed ? (
      <>
        <AlertTriangle size={16} />
        <span>Could not load the video for this recording.</span>
      </>
    ) : (
      <>
        <Spinner size={16} className='animate-spin' />
        <span>Loading video…</span>
      </>
    )}
  </div>
);

interface RecordingVideoToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const RecordingVideoToggle = ({
  isOpen,
  onToggle,
}: RecordingVideoToggleProps): ReactElement => {
  const label = isOpen ? 'Hide video' : 'Show video';

  return (
    <Button
      type='button'
      variant='outline'
      size='icon'
      onClick={onToggle}
      className='size-8 shrink-0 rounded-full border-border bg-card text-muted-foreground hover:text-foreground'
      aria-label={label}
      aria-pressed={isOpen}
      title={label}
      data-track-category='RecordingDetailV2'
      data-track-name={isOpen ? 'hide_recording_video' : 'show_recording_video'}
    >
      {isOpen ? <VideoOff size={14} /> : <Video size={14} />}
    </Button>
  );
};

interface InlineRecordingVideoProps {
  video: RecordingVideoSource;
  title: string;
  initialTime: number;
  onExpand: () => void;
}

/** Explicit width/height keep VideoViewer in inline mode, where expand calls `onExpand`. */
export const InlineRecordingVideo = forwardRef<HTMLVideoElement, InlineRecordingVideoProps>(
  ({ video, title, initialTime, onExpand }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { width, height } = useMeasure({ ref: containerRef, observeResize: true });
    const hasSize = width > 0 && height > 0;

    return (
      <div
        ref={containerRef}
        className='mb-4 aspect-video max-h-[420px] w-full overflow-hidden rounded-xl bg-black'
      >
        {video.status === 'ready' && hasSize ? (
          <VideoViewer
            ref={ref}
            {...getViewerSourceProps(video, title)}
            width={Math.floor(width)}
            height={Math.floor(height)}
            initialTime={initialTime}
            autoPlay
            onExpand={onExpand}
          />
        ) : (
          <VideoStatus failed={video.status === 'failed'} />
        )}
      </div>
    );
  },
);
InlineRecordingVideo.displayName = 'InlineRecordingVideo';

interface RecordingVideoDialogProps {
  title: string;
  video: ReadyRecordingVideoSource;
  initialTime: number;
  onClose: (currentTime: number) => void;
}

export const RecordingVideoDialog = ({
  title,
  video,
  initialTime,
  onClose,
}: RecordingVideoDialogProps): ReactElement => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const close = (): void => onClose(videoRef.current?.currentTime ?? initialTime);

  return (
    <Dialog
      open
      onOpenChange={open => !open && close()}
      title={title}
      mobileVariant='dialog'
      className='aspect-video w-[min(95vw,calc(90vh*16/9))] max-w-none overflow-hidden rounded-2xl bg-black p-0'
      testId='recording-video-dialog'
    >
      <VideoViewer
        ref={videoRef}
        {...getViewerSourceProps(video, title)}
        initialTime={initialTime}
        autoPlay
        fillContainer
        onExpand={close}
      />
    </Dialog>
  );
};
