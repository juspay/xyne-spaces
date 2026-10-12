import {
  Component,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Download, FileQuestion, Search } from 'lucide-react';
import { downloadFile } from '../../services/clients/fileFetchService';
import { logger, Event as LogEvent } from '../../utils/logger';
import { formatFileSize } from '../FileViewer/utils';
import { PreviewButton, PreviewFrame, PreviewMessage, PreviewSkeletonView } from './chrome';
import { usePreviewContent } from './content';
import type { FindProvider } from './find';
import { useFindBar } from './FindBar';
import { extensionOf, previewerFor } from './registry';
import type { PreviewFile } from './types';

/** A previewer that throws — a corrupt sheet, a decoder giving up — fails its own
 *  pane, not the page around it. */
class PreviewBoundary extends Component<
  { fallback: ReactNode; resetKey: string; children: ReactNode },
  { failed: boolean; resetKey: string }
> {
  override state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; resetKey: string },
  ): { failed: boolean; resetKey: string } | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(LogEvent.FRONTEND_ERROR, {
      message: 'File preview failed to draw',
      error: error.message,
      componentStack: info.componentStack ?? '',
    });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * An uploaded file, previewed: a toolbar saying what it is, with the previewer's own
 * controls and the download, over whichever previewer the registry picks for it.
 * Loading, a rendition the server is still making, failure, a file too large and a
 * type nothing previews are drawn here, the same for every kind of file.
 */
export function FilePreview(props: {
  file: PreviewFile;
  /** The file's icon, for the states with nothing else to show. */
  icon?: ReactNode;
  /** What the file is, in words, when the surface has its own name for it. */
  typeLabel?: string;
}): ReactElement {
  const { file } = props;
  const previewer = useMemo(() => previewerFor(file), [file]);
  const tooLarge = previewer?.maxBytes !== undefined && file.size > previewer.maxBytes;
  const { state, retry } = usePreviewContent(file, tooLarge ? null : previewer);
  const [controls, setControls] = useState<HTMLElement | null>(null);
  const [trailing, setTrailing] = useState<HTMLElement | null>(null);
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  // What the view on screen can search, lent by it; none for an image or a video.
  const [finder, setFinder] = useState<FindProvider | null>(null);
  const find = useFindBar(finder);

  const download = useCallback(() => {
    void downloadFile(file.id, file.name).catch(error => {
      logger.error(LogEvent.FRONTEND_ERROR, {
        message: 'File preview download failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [file.id, file.name]);
  const frame = useMemo(
    () => ({ controls, trailing, meta, download, setFinder, openFind: find.open }),
    [controls, trailing, meta, download, find.open],
  );

  const extension = extensionOf(file.name);
  const typeLabel =
    props.typeLabel ?? previewer?.label ?? (extension ? extension.toUpperCase() : 'File');
  const icon = props.icon ?? <FileQuestion className='size-10 text-muted-foreground' />;
  const downloadAction = {
    label: 'Download',
    onClick: download,
    primary: true,
    trackName: 'PreviewDownloaded',
  };

  let body: ReactNode;
  if (!previewer) {
    body = (
      <PreviewMessage
        icon={icon}
        title={`No preview for ${extension ? `.${extension}` : 'this'} files yet`}
        body='Download it to open it in the app it was made with.'
        actions={[downloadAction]}
      />
    );
  } else if (tooLarge) {
    body = (
      <PreviewMessage
        icon={icon}
        title='Too large to preview here'
        body={`Previews go up to ${formatFileSize(previewer.maxBytes ?? 0)}. Download it to see all of it.`}
        actions={[downloadAction]}
      />
    );
  } else if (state.status === 'failed') {
    body = (
      <PreviewMessage
        icon={icon}
        title="Couldn't load this file"
        body='Something went wrong fetching it. Try again, or download it instead.'
        actions={[
          { label: 'Try again', onClick: retry, trackName: 'PreviewRetried' },
          downloadAction,
        ]}
      />
    );
  } else if (state.status === 'ready') {
    const Preview = previewer.component;
    body = (
      <PreviewBoundary
        resetKey={`${file.id}:${previewer.id}`}
        fallback={
          <PreviewMessage
            icon={icon}
            title="Couldn't preview this file"
            body='It may be damaged, or in a form the preview cannot read. Download it to open it.'
            actions={[downloadAction]}
          />
        }
      >
        <Suspense fallback={<PreviewSkeletonView shape={previewer.skeleton} />}>
          <Preview file={file} content={state.content} />
        </Suspense>
      </PreviewBoundary>
    );
  } else {
    body = (
      <PreviewSkeletonView
        shape={previewer.skeleton}
        {...(state.status === 'preparing' && { note: 'Preparing preview…' })}
      />
    );
  }

  return (
    <PreviewFrame.Provider value={frame}>
      <div className='flex h-full min-h-0 flex-col bg-background'>
        <div className='flex h-10 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2'>
          <div
            ref={setMeta}
            className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'
          >
            <span className='shrink-0'>{typeLabel}</span>
            <span aria-hidden='true'>·</span>
            <span className='shrink-0 tabular-nums'>{formatFileSize(file.size)}</span>
          </div>
          {/* Where the previewer's own controls go. */}
          <div ref={setControls} className='ml-auto flex shrink-0 items-center gap-1' />
          <span aria-hidden='true' className='mx-1 h-4 w-px shrink-0 bg-border' />
          {finder && (
            <PreviewButton title='Find (⌘F)' onClick={find.open} trackName='PreviewFindOpened'>
              <Search className='size-4' />
            </PreviewButton>
          )}
          <PreviewButton title='Download' onClick={download} trackName='PreviewDownloaded'>
            <Download className='size-4' />
          </PreviewButton>
          {/* The far end, for a previewer's panel toggle; nothing when it has none. */}
          <div ref={setTrailing} className='flex shrink-0 items-center gap-1 empty:hidden' />
        </div>
        <div className='relative min-h-0 flex-1'>
          {body}
          {find.bar}
        </div>
      </div>
    </PreviewFrame.Provider>
  );
}
